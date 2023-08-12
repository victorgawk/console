// Copyright 2022 Redpanda Data, Inc.
//
// Use of this software is governed by the Business Source License
// included in the file https://github.com/redpanda-data/redpanda/blob/dev/licenses/bsl.md
//
// As of the Change Date specified in that file, in accordance with
// the Business Source License, use of this software will be governed
// by the Apache License, Version 2.0

package kafka

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	xj "github.com/basgys/goxml2json"
	"github.com/hamba/avro/v2"
	"github.com/twmb/franz-go/pkg/kbin"
	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/twmb/franz-go/pkg/kmsg"
	"github.com/vmihailenco/msgpack/v5"
	"github.com/zencoder/go-smile/smile"

	kmsgpack "github.com/redpanda-data/console/backend/pkg/msgpack"
	"github.com/redpanda-data/console/backend/pkg/proto"
	"github.com/redpanda-data/console/backend/pkg/schema"
)

// deserializer can deserialize messages from various formats (json, xml, avro, ..) into a Go native form.
type deserializer struct {
	SchemaService  *schema.Service
	ProtoService   *proto.Service
	MsgPackService *kmsgpack.Service
}

type messageEncoding string

const (
	messageEncodingNone                 messageEncoding = "none"
	messageEncodingAvro                 messageEncoding = "avro"
	messageEncodingProtobuf             messageEncoding = "protobuf"
	messageEncodingJSON                 messageEncoding = "json"
	messageEncodingXML                  messageEncoding = "xml"
	messageEncodingText                 messageEncoding = "text"
	messageEncodingUtf8WithControlChars messageEncoding = "utf8WithControlChars"
	messageEncodingConsumerOffsets      messageEncoding = "consumerOffsets"
	messageEncodingBinary               messageEncoding = "binary"
	messageEncodingMsgP                 messageEncoding = "msgpack"
	messageEncodingSmile                messageEncoding = "smile"
)

// normalizedPayload is a wrapper of the original message with the purpose of having a custom JSON marshal method
type normalizedPayload struct {
	// Payload is the original payload except for all message encodings which can be converted to a JSON object
	Payload            []byte
	RecognizedEncoding messageEncoding `json:"encoding"`
}

// MarshalJSON implements the 'Marshaller' interface for deserialized payload.
// We do this because we want to pass the deserialized payload as JavaScript object (regardless of the encoding) to the frontend.
func (d *normalizedPayload) MarshalJSON() ([]byte, error) {
	switch d.RecognizedEncoding {
	case messageEncodingNone:
		return []byte("{}"), nil
	case messageEncodingText:
		return json.Marshal(string(d.Payload))
	case messageEncodingBinary, messageEncodingUtf8WithControlChars:
		b64 := base64.StdEncoding.EncodeToString(d.Payload)
		return json.Marshal(b64)
	default:
		return d.Payload, nil
	}
}

type deserializedPayload struct {
	Payload       normalizedPayload `json:"payload"`
	IsPayloadNull bool              `json:"isPayloadNull"`

	// Object is the parsed version of the payload. This will be passed to the JavaScript interpreter
	Object             interface{}     `json:"-"`
	RecognizedEncoding messageEncoding `json:"encoding"`
	SchemaID           uint32          `json:"schemaId"`
	Size               int             `json:"size"` // number of 'raw' bytes
}

type deserializedRecord struct {
	Key     *deserializedPayload
	Value   *deserializedPayload
	Headers map[string]*deserializedPayload
}

// DeserializeRecord tries to deserialize a whole record.
// The payload's byte array may represent
//   - an encoded message such as JSON, Avro, Protobuf, MsgPack or XML
//   - UTF-8 Text
//   - Binary content
//
// Idea: Add encoding hint where user can suggest the backend to test this encoding first.
func (d *deserializer) DeserializeRecord(record *kgo.Record, parseJavaToJson bool) *deserializedRecord {
	// 1. Test if it's a known binary Format
	if record.Topic == "__consumer_offsets" {
		rec, err := d.deserializeConsumerOffset(record)
		if err == nil {
			return rec
		}
	}

	if parseJavaToJson {
		if record.Topic != "event-in" && record.Topic != "event-out" && record.Topic != "online-connector" && record.Topic != "online-connector-out" {
			obj, err := ParseBase64ToMarshal(record.Value)
			if err == nil {
				record.Value = obj
			}
		}
	}

	headers := make(map[string]*deserializedPayload)
	for _, header := range record.Headers {
		headers[header.Key] = d.deserializePayload(header.Value, record.Topic, proto.RecordValue)
	}
	deserializedRecord := &deserializedRecord{
		Key:     d.deserializePayload(record.Key, record.Topic, proto.RecordKey),
		Value:   d.deserializePayload(record.Value, record.Topic, proto.RecordValue),
		Headers: headers,
	}

	if parseJavaToJson {
		if record.Topic == "online-connector-out" {
			obj, err := ParseBase64ToObject(record.Value)
			if err == nil {
				deserializedRecord.Value.Payload.Payload = []byte(fmt.Sprint(obj))
			}
		}
	}

	return deserializedRecord
}

// deserializePayload tries to deserialize a binary payload into a human-readable format,
// so that we can send this to the frontend for rendering it to the user. Because we don't
// know what format has been used to produce the payload we try to guess the right
// type (JSON, Text, XML, Protobuf, Avro etc) by trying to decode each message into
// the respective type. If none matches, we return the binary content as is and it
// will be displayed as hex string in the frontend.
//
//nolint:gocognit,cyclop,gocyclo // This function should be refactored and broken into multiple functions
func (d *deserializer) deserializePayload(payload []byte, topicName string, recordType proto.RecordPropertyType) *deserializedPayload {
	// 0. Check if payload is empty / whitespace only
	if len(payload) == 0 {
		return &deserializedPayload{
			Payload: normalizedPayload{
				Payload:            payload,
				RecognizedEncoding: messageEncodingNone,
			},
			IsPayloadNull:      payload == nil,
			Object:             nil,
			RecognizedEncoding: messageEncodingNone,
			Size:               len(payload),
		}
	}

	trimmed := bytes.TrimLeft(payload, " \t\r\n")
	if len(trimmed) == 0 {
		return &deserializedPayload{
			Payload: normalizedPayload{
				Payload:            payload,
				RecognizedEncoding: messageEncodingText,
			},
			IsPayloadNull:      payload == nil,
			Object:             string(payload),
			RecognizedEncoding: messageEncodingText,
			Size:               len(payload),
		}
	}

	// 1. Test for valid JSON
	startsWithJSON := trimmed[0] == '[' || trimmed[0] == '{'
	if startsWithJSON {
		var obj interface{}
		err := json.Unmarshal(payload, &obj)
		if err == nil {
			return &deserializedPayload{
				Payload: normalizedPayload{
					Payload:            trimmed,
					RecognizedEncoding: messageEncodingJSON,
				},
				IsPayloadNull:      payload == nil,
				Object:             obj,
				RecognizedEncoding: messageEncodingJSON,
				Size:               len(payload),
			}
		}
	}

	// 2. Test for json schema
	if d.SchemaService != nil && len(payload) > 5 && payload[0] == byte(0) {
		// TODO: For more confidence we could just ask the schema service for the given
		// schema and based on the response we can check the schema type (avro, json, ..)
		schemaID := binary.BigEndian.Uint32(payload[1:5])
		trimmed := payload[5:]
		startsWithJSON := trimmed[0] == '[' || trimmed[0] == '{'
		if startsWithJSON {
			var obj interface{}
			err := json.Unmarshal(payload[5:], &obj)
			if err == nil {
				return &deserializedPayload{
					Payload: normalizedPayload{
						Payload:            trimmed,
						RecognizedEncoding: messageEncodingJSON,
					},
					IsPayloadNull:      payload == nil,
					Object:             obj,
					RecognizedEncoding: messageEncodingJSON,
					SchemaID:           schemaID,
					Size:               len(payload),
				}
			}
		}
	}

	// 3. Test for valid XML
	startsWithXML := trimmed[0] == '<'
	if startsWithXML {
		r := strings.NewReader(string(trimmed))
		jsonPayload, err := xj.Convert(r)
		if err == nil {
			var obj interface{}
			_ = json.Unmarshal(jsonPayload.Bytes(), &obj) // no err possible unless the xml2json package is buggy
			return &deserializedPayload{
				Payload: normalizedPayload{
					Payload:            jsonPayload.Bytes(),
					RecognizedEncoding: messageEncodingXML,
				},
				IsPayloadNull:      payload == nil,
				Object:             obj,
				RecognizedEncoding: messageEncodingXML,
				Size:               len(payload),
			}
		}
	}

	// 4. Test for Avro (reference: https://docs.confluent.io/current/schema-registry/serdes-develop/index.html#wire-format)
	if d.SchemaService != nil && len(payload) > 5 {
		// Check if magic byte is set
		if payload[0] == byte(0) {
			schemaID := binary.BigEndian.Uint32(payload[1:5])

			schema, err := d.SchemaService.GetAvroSchemaByID(schemaID)
			if err == nil {
				var obj interface{}
				if err := avro.Unmarshal(schema, payload[5:], &obj); err == nil {
					jsonBytes, _ := json.Marshal(obj)
					return &deserializedPayload{
						Payload: normalizedPayload{
							Payload:            jsonBytes,
							RecognizedEncoding: messageEncodingAvro,
						},
						IsPayloadNull:      payload == nil,
						Object:             obj,
						RecognizedEncoding: messageEncodingAvro,
						SchemaID:           schemaID,
						Size:               len(payload),
					}
				}
			}
		}
	}

	// 5. Test for Protobuf
	if d.ProtoService != nil {
		jsonBytes, schemaID, err := d.ProtoService.UnmarshalPayload(payload, topicName, recordType)
		if err == nil {
			var native interface{}
			err := json.Unmarshal(jsonBytes, &native)
			if err == nil {
				return &deserializedPayload{
					Payload: normalizedPayload{
						Payload:            jsonBytes,
						RecognizedEncoding: messageEncodingProtobuf,
					},
					IsPayloadNull:      payload == nil,
					Object:             native,
					RecognizedEncoding: messageEncodingProtobuf,
					SchemaID:           uint32(schemaID),
					Size:               len(payload),
				}
			}
		}
	}

	// 6. Test for MessagePack (only if enabled and topic allowed)
	if d.MsgPackService != nil && d.MsgPackService.IsTopicAllowed(topicName) {
		var obj interface{}
		err := msgpack.Unmarshal(payload, &obj)
		if err == nil {
			data, err := json.Marshal(obj)
			if err == nil {
				return &deserializedPayload{
					Payload: normalizedPayload{
						Payload:            data,
						RecognizedEncoding: messageEncodingMsgP,
					},
					IsPayloadNull:      payload == nil,
					Object:             string(payload),
					RecognizedEncoding: messageEncodingMsgP,
					Size:               len(payload),
				}
			}
		}
	}

	// 7. Test for valid Smile
	startsWithSmile := len(payload) > 3 && payload[0] == ':' && payload[1] == ')' && payload[2] == '\n'
	if startsWithSmile {
		obj, err := smile.DecodeToObject(payload)
		if err == nil {
			jsonBytes, err := json.Marshal(obj)
			if err == nil {
				return &deserializedPayload{
					Payload: normalizedPayload{
						Payload:            jsonBytes,
						RecognizedEncoding: messageEncodingSmile,
					},
					IsPayloadNull:      payload == nil,
					Object:             obj,
					RecognizedEncoding: messageEncodingSmile,
					Size:               len(payload),
				}
			}
		}
	}

	// 8. Test for UTF-8 validity
	isUTF8 := utf8.Valid(payload)
	if isUTF8 {
		// If we have an UTF8 string with control chars (e.g. byte array with 0x00) we want to
		// render all control chars as pills and the rest as a human-readable string.
		// Thus, if the utf8 string contains any control chars we will send it as binary data.
		if d.containsControlChars(payload) {
			return &deserializedPayload{
				Payload: normalizedPayload{
					Payload:            payload,
					RecognizedEncoding: messageEncodingUtf8WithControlChars,
				},
				IsPayloadNull:      payload == nil,
				Object:             payload,
				RecognizedEncoding: messageEncodingUtf8WithControlChars,
				Size:               len(payload),
			}
		}
		return &deserializedPayload{
			Payload: normalizedPayload{
				Payload:            payload,
				RecognizedEncoding: messageEncodingText,
			},
			IsPayloadNull:      payload == nil,
			Object:             string(payload),
			RecognizedEncoding: messageEncodingText,
			Size:               len(payload),
		}
	}

	// Anything else is considered as binary content
	return &deserializedPayload{
		Payload: normalizedPayload{
			Payload:            payload,
			RecognizedEncoding: messageEncodingBinary,
		},
		IsPayloadNull:      payload == nil,
		Object:             payload,
		RecognizedEncoding: messageEncodingBinary,
		Size:               len(payload),
	}
}

// deserializeConsumerOffset deserializes the binary messages in the __consumer_offsets topic
func (*deserializer) deserializeConsumerOffset(record *kgo.Record) (*deserializedRecord, error) {
	if len(record.Key) < 2 {
		return nil, fmt.Errorf("offset commit key is supposed to be at least 2 bytes long")
	}

	// 1. Figure out what kind of message we've got. On this topic we'll find OffsetCommits as well as GroupMetadata
	// messages.
	messageVer := (&kbin.Reader{Src: record.Key}).Int16()

	var deserializedKey *deserializedPayload
	var deserializedVal *deserializedPayload
	switch messageVer {
	case 0, 1:
		// We got an offset commit message
		offsetCommitKey := kmsg.NewOffsetCommitKey()
		err := offsetCommitKey.ReadFrom(record.Key)
		if err == nil {
			key, _ := json.Marshal(offsetCommitKey)
			deserializedKey = &deserializedPayload{
				Payload: normalizedPayload{
					Payload:            key,
					RecognizedEncoding: messageEncodingConsumerOffsets,
				},
				Object:             offsetCommitKey,
				RecognizedEncoding: messageEncodingConsumerOffsets,
				Size:               len(record.Key),
			}
		}

		if record.Value == nil {
			break
		}
		offsetCommitValue := kmsg.NewOffsetCommitValue()
		err = offsetCommitValue.ReadFrom(record.Value)
		if err == nil {
			val, _ := json.Marshal(offsetCommitValue)
			deserializedVal = &deserializedPayload{
				Payload: normalizedPayload{
					Payload:            val,
					RecognizedEncoding: messageEncodingConsumerOffsets,
				},
				Object:             val,
				RecognizedEncoding: messageEncodingConsumerOffsets,
				Size:               len(record.Value),
			}
		}
	case 2:
		// We got a group metadata message
		metadataKey := kmsg.NewGroupMetadataKey()
		err := metadataKey.ReadFrom(record.Key)
		if err == nil {
			key, _ := json.Marshal(metadataKey)
			deserializedKey = &deserializedPayload{
				Payload: normalizedPayload{
					Payload:            key,
					RecognizedEncoding: messageEncodingConsumerOffsets,
				},
				Object:             metadataKey,
				RecognizedEncoding: messageEncodingConsumerOffsets,
				Size:               len(record.Key),
			}
		}

		if record.Value == nil {
			break
		}
		metadataValue := kmsg.NewGroupMetadataValue()
		err = metadataValue.ReadFrom(record.Value)
		if err == nil {
			key, _ := json.Marshal(metadataValue)
			deserializedVal = &deserializedPayload{
				Payload: normalizedPayload{
					Payload:            key,
					RecognizedEncoding: messageEncodingConsumerOffsets,
				},
				Object:             metadataValue,
				RecognizedEncoding: messageEncodingConsumerOffsets,
				Size:               len(record.Value),
			}
		}
	default:
		// Unknown format
		return nil, fmt.Errorf("unknown message version '%d' detected", messageVer)
	}

	if deserializedVal == nil {
		// Tombstone
		deserializedVal = &deserializedPayload{Payload: normalizedPayload{
			Payload:            record.Value,
			RecognizedEncoding: messageEncodingNone,
		}, Object: "", RecognizedEncoding: messageEncodingNone, Size: len(record.Value)}
	}
	return &deserializedRecord{
		Key:     deserializedKey,
		Value:   deserializedVal,
		Headers: nil,
	}, nil
}

func (*deserializer) containsControlChars(b []byte) bool {
	for _, v := range b {
		if (v <= 31) || (v >= 127 && v <= 159) {
			return true
		}
	}
	return false
}
