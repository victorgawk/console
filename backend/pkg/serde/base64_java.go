package serde

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"unicode/utf8"

	"github.com/twmb/franz-go/pkg/kgo"
	"github.com/victorgawk/java2json-go/java2json"
)

const maxObjectNodeDepth int = 7
const maxStringLength int = 4000

var _ Serde = (*Base64JavaSerde)(nil)

// Base64JavaSerde represents the serde for dealing with Base64 Java types.
type Base64JavaSerde struct{}

// Name returns the name of the serde payload encoding.
func (Base64JavaSerde) Name() PayloadEncoding {
	return PayloadEncodingBase64Java
}

// DeserializePayload deserializes the kafka record to our internal record payload representation.
func (Base64JavaSerde) DeserializePayload(_ context.Context, record *kgo.Record, payloadType PayloadType) (*RecordPayload, error) {
	payload := payloadFromRecord(record, payloadType)

	bytes, err := base64.StdEncoding.DecodeString(string(payload))
	if err != nil {
		return &RecordPayload{}, fmt.Errorf("error decoding base64: %w", err)
	}

	obj, err := java2json.ParseJavaObject(bytes)
	if err != nil {
		return &RecordPayload{}, fmt.Errorf("error parsing java object: %w", err)
	}

	obj = truncateObject(obj, 0, maxObjectNodeDepth, maxStringLength)

	jsonBytes, err := json.Marshal(obj)
	if err != nil {
		return &RecordPayload{}, fmt.Errorf("error marshalling JSON: %w", err)
	}

	return &RecordPayload{
		DeserializedPayload: obj,
		NormalizedPayload:   jsonBytes,
		Encoding:            PayloadEncodingBase64Java,
	}, nil
}

// SerializeObject serializes data into binary format ready for writing to Kafka as a record.
func (Base64JavaSerde) SerializeObject(_ context.Context, obj any, _ PayloadType, opts ...SerdeOpt) ([]byte, error) {
	so := serdeCfg{}
	for _, o := range opts {
		o.apply(&so)
	}

	var byteData []byte
	switch v := obj.(type) {
	case string:
		byteData = []byte(v)
	case []byte:
		byteData = v
	default:
		return nil, fmt.Errorf("unsupported type %+T for text serialization", obj)
	}

	isUTF8 := utf8.Valid(byteData)
	if !isUTF8 {
		return nil, fmt.Errorf("payload is not UTF8")
	}

	// If message encoding text is used and the byte array is empty, the user
	// probably wants to write an empty string, rather than null.
	if byteData == nil {
		byteData = []byte("")
	}

	return byteData, nil
}

// truncateObject delete nodes deeper than maxDepth and truncate strings bigger than maxStringLength.
func truncateObject(obj any, depth int, maxDepth int, maxStringLength int) interface{} {
	if maxDepth <= 0 || obj == nil {
		return obj
	}

	switch obj := obj.(type) {
	case string:
		if len(obj) > maxStringLength {
			return obj[:maxStringLength]
		}
	case []interface{}:
		if depth+1 >= maxDepth {
			return obj[:0]
		} else {
			for index, value := range obj {
				obj[index] = truncateObject(value, depth+1, maxDepth, maxStringLength)
			}
		}
	case map[string]interface{}:
		if depth+1 >= maxDepth {
			for key := range obj {
				delete(obj, key)
			}
		} else {
			for key, value := range obj {
				obj[key] = truncateObject(value, depth+1, maxDepth, maxStringLength)
			}
		}
	}

	return obj
}
