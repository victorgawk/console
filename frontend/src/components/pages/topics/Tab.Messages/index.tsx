/**
 * Copyright 2022 Redpanda Data, Inc.
 *
 * Use of this software is governed by the Business Source License
 * included in the file https://github.com/redpanda-data/redpanda/blob/dev/licenses/bsl.md
 *
 * As of the Change Date specified in that file, in accordance with
 * the Business Source License, use of this software will be governed
 * by the Apache License, Version 2.0
 */

import { ClockCircleOutlined, DeleteOutlined, DownloadOutlined, SettingOutlined } from '@ant-design/icons';
import { InfoIcon, WarningIcon } from '@chakra-ui/icons';
import { CogIcon } from '@heroicons/react/solid';
import { DownloadIcon, KebabHorizontalIcon, SkipIcon, SyncIcon, XCircleIcon } from '@primer/octicons-react';
import {
    Alert,
    AlertDescription,
    AlertIcon,
    AlertTitle,
    Box,
    Button,
    Checkbox,
    DataTable,
    DateTimeInput,
    Empty,
    Flex,
    Grid,
    GridItem,
    Heading,
    Input,
    Link,
    Menu,
    MenuButton,
    MenuDivider,
    MenuItem,
    MenuList,
    Modal,
    ModalBody,
    ModalCloseButton,
    ModalContent,
    ModalFooter,
    ModalHeader,
    ModalOverlay,
    RadioGroup,
    Tabs as RpTabs,
    Select,
    Tag,
    TagCloseButton,
    TagLabel,
    Text,
    Tooltip,
    useBreakpoint,
    useColorModeValue,
    useToast,
    VStack
} from '@redpanda-data/ui';
import { ColumnDef } from '@tanstack/react-table';
import { MultiValue } from 'chakra-react-select';
import { action, autorun, computed, IReactionDisposer, makeObservable, observable, transaction, untracked } from 'mobx';
import { observer } from 'mobx-react';
import React, { Component, FC, ReactNode, useState } from 'react';
import {
    MdAdd,
    MdExpandMore,
    MdJavascript,
    MdOutlineLayers,
    MdOutlineRoundedCorner,
    MdOutlineSearch
} from 'react-icons/md';
import { Link as ReactRouterLink } from 'react-router-dom';
import { isServerless } from '../../../../config';
import usePaginationParams from '../../../../hooks/usePaginationParams';
import { PayloadEncoding } from '../../../../protogen/redpanda/api/console/v1alpha1/common_pb';
import { appGlobal } from '../../../../state/appGlobal';
import { api, createMessageSearch, MessageSearch, MessageSearchRequest } from '../../../../state/backendApi';
import { Payload, Topic, TopicAction, TopicMessage } from '../../../../state/restInterfaces';
import { Feature, isSupported } from '../../../../state/supportedFeatures';
import {
    ColumnList,
    DataColumnKey,
    DEFAULT_SEARCH_PARAMS,
    FilterEntry,
    PartitionOffsetOrigin,
    PreviewTagV2,
    TimestampDisplayFormat,
    uiSettings,
} from '../../../../state/ui';
import { uiState } from '../../../../state/uiState';
import '../../../../utils/arrayExtensions';
import { IsDev } from '../../../../utils/env';
import { FilterableDataSource } from '../../../../utils/filterableDataSource';
import { sanitizeString, wrapFilterFragment } from '../../../../utils/filterHelper';
import { toJson } from '../../../../utils/jsonUtils';
import { onPaginationChange } from '../../../../utils/pagination';
import { editQuery } from '../../../../utils/queryHelper';
import {
    Ellipsis,
    Label,
    navigatorClipboardErrorHandler,
    numberToThousandsString,
    OptionGroup,
    StatusIndicator,
    TimestampDisplay,
    toSafeString
} from '../../../../utils/tsxUtils';
import {
    base64FromUInt8Array,
    cullText,
    encodeBase64,
    prettyBytes,
    prettyMilliseconds,
    titleCase
} from '../../../../utils/utils';
import { range } from '../../../misc/common';
import { KowlJsonView } from '../../../misc/KowlJsonView';
import RemovableFilter from '../../../misc/RemovableFilter';
import { SingleSelect, SingleSelectProps } from '../../../misc/Select';
import DeleteRecordsModal from '../DeleteRecordsModal/DeleteRecordsModal';
import JavascriptFilterModal from './JavascriptFilterModal';
import { getPreviewTags, PreviewSettings } from './PreviewSettings';
import styles from './styles.module.scss';


const payloadEncodingPairs = [
    { value: PayloadEncoding.UNSPECIFIED, label: 'Automatic' },
    { value: PayloadEncoding.NULL, label: 'None (Null)' },
    { value: PayloadEncoding.AVRO, label: 'AVRO' },
    { value: PayloadEncoding.PROTOBUF, label: 'Protobuf' },
    { value: PayloadEncoding.PROTOBUF_SCHEMA, label: 'Protobuf Schema' },
    { value: PayloadEncoding.JSON, label: 'JSON' },
    { value: PayloadEncoding.JSON_SCHEMA, label: 'JSON Schema' },
    { value: PayloadEncoding.XML, label: 'XML' },
    { value: PayloadEncoding.TEXT, label: 'Plain Text' },
    { value: PayloadEncoding.UTF8, label: 'UTF-8' },
    { value: PayloadEncoding.MESSAGE_PACK, label: 'Message Pack' },
    { value: PayloadEncoding.SMILE, label: 'Smile' },
    { value: PayloadEncoding.BINARY, label: 'Binary' },
    { value: PayloadEncoding.UINT, label: 'Unsigned Int' },
    { value: PayloadEncoding.CONSUMER_OFFSETS, label: 'Consumer Offsets' },
    { value: PayloadEncoding.BASE64_JAVA, label: 'Base64 Java' },
];



interface TopicMessageViewProps {
    topic: Topic;
    refreshTopicData: (force: boolean) => void;
}

/*
    TODO:
        - when the user has entered a specific offset, we should prevent selecting 'all' partitions, as that wouldn't make any sense.
        - add back summary of quick search  <this.FilterSummary />
*/

function getMessageAsString(value: string | TopicMessage): string {
    if (typeof value === 'string')
        return value;

    const obj = Object.assign({}, value) as Partial<TopicMessage>;
    delete obj.keyBinHexPreview;
    delete obj.valueBinHexPreview;
    delete obj.keyJson;
    delete obj.valueJson;
    if (obj.key) {
        delete obj.key.normalizedPayload;
        if (obj.key.rawBytes)
            obj.key.rawBytes = Array.from(obj.key.rawBytes) as any;
    }
    if (obj.value) {
        delete obj.value.normalizedPayload;
        if (obj.value.rawBytes)
            obj.value.rawBytes = Array.from(obj.value.rawBytes) as any;
    }

    return JSON.stringify(obj, null, 4);
}

function getPayloadAsString(value: string | Uint8Array | object): string {

    if (value == null)
        return '';

    if (typeof value === 'string')
        return value;

    if (value instanceof Uint8Array)
        return JSON.stringify(Array.from(value), null, 4);

    return JSON.stringify(value, null, 4);
}

const inlineSelectChakraStyles: SingleSelectProps<PayloadEncoding | number>['chakraStyles'] = {
    control: (provided) => ({
        ...provided,
        _hover: {
            borderColor: 'transparent'
        },
    }),
      container: (provided) => ({
    ...provided,
    borderColor: 'transparent',
}),
}

@observer
export class TopicMessageView extends Component<TopicMessageViewProps> {
    @observable previewDisplay: string[] = [];
    // @observable allCurrentKeys: string[];

    @observable showColumnSettings = false;

    @observable fetchError = null as any | null;

    messageSearch = createMessageSearch();
    messageSource = new FilterableDataSource<TopicMessage>(() => this.messageSearch.messages, this.isFilterMatch, 16);

    autoSearchReaction: IReactionDisposer | null = null;
    quickSearchReaction: IReactionDisposer | null = null;

    currentSearchRun: string | null = null;

    @observable downloadMessages: TopicMessage[] | null;
    @observable expandedKeys: React.Key[] = [];

    @observable deleteRecordsModalVisible = false;
    @observable deleteRecordsModalAlive = false;

    constructor(props: TopicMessageViewProps) {
        super(props);
        this.executeMessageSearch = this.executeMessageSearch.bind(this); // needed because we must pass the function directly as 'submit' prop

        makeObservable(this);
    }

    componentDidMount() {
        // unpack query parameters (if any)
        const searchParams = uiState.topicSettings.searchParams;
        const query = new URLSearchParams(window.location.search);
        // console.debug("parsing query: " + toJson(query));
        if (query.has('p')) searchParams.partitionID = Number(query.get('p'));
        if (query.has('s')) searchParams.maxResults = Number(query.get('s'));
        if (query.has('o')) {
            searchParams.startOffset = Number(query.get('o'));
            searchParams.offsetOrigin = (searchParams.startOffset >= 0) ? PartitionOffsetOrigin.Custom : searchParams.startOffset;
        }
        if (query.has('q')) uiState.topicSettings.quickSearch = String(query.get('q'));

        // Auto search when parameters change
        this.autoSearchReaction = autorun(() => this.searchFunc('auto'), { delay: 100, name: 'auto search when parameters change' });

        // Quick search -> url
        this.quickSearchReaction = autorun(() => {
            editQuery(query => {
                if (uiState.topicSettings.quickSearch)
                    query['q'] = uiState.topicSettings.quickSearch;
                else
                    query['q'] = undefined;
            });
        }, { name: 'update query string' });

        this.messageSource.filterText = uiState.topicSettings.quickSearch;
    }
    componentWillUnmount() {
        this.messageSource.dispose();
        if (this.autoSearchReaction)
            this.autoSearchReaction();
        if (this.quickSearchReaction)
            this.quickSearchReaction();

        this.messageSearch.stopSearch();
    }

    render() {
        return <>
            <this.SearchControlsBar />

            {/* Message Table (or error display) */}
            {this.fetchError
                ? <Alert status="error">
                    <AlertIcon alignSelf="flex-start" />
                    <Box>
                        <AlertTitle>Backend Error</AlertTitle>
                        <AlertDescription>
                            <Box>Please check and modify the request before resubmitting.</Box>
                            <Box mt="4">
                                <div className="codeBox">{((this.fetchError as Error).message ?? String(this.fetchError))}</div>
                            </Box>
                            <Button mt="4" onClick={() => this.executeMessageSearch()}>
                                Retry Search
                            </Button>
                        </AlertDescription>
                    </Box>
                </Alert>
                : <>
                    <this.MessageTable />
                </>
            }

            {
                this.deleteRecordsModalAlive
                && (
                    <DeleteRecordsModal
                        topic={this.props.topic}
                        visible={this.deleteRecordsModalVisible}
                        onCancel={() => this.deleteRecordsModalVisible = false}
                        onFinish={() => {
                            this.deleteRecordsModalVisible = false;
                            this.props.refreshTopicData(true);
                            this.searchFunc('auto');
                        }}
                        afterClose={() => this.deleteRecordsModalAlive = false}
                    />
                )
            }
        </>;
    }
    SearchControlsBar = observer(() => {
        const searchParams = uiState.topicSettings.searchParams;
        const topic = this.props.topic;
        const canUseFilters = (api.topicPermissions.get(topic.topicName)?.canUseSearchFilters ?? true) && !isServerless();
        const [customStartOffsetValue, setCustomStartOffsetValue] = useState(0 as number | string);
        const customStartOffsetValid = !isNaN(Number(customStartOffsetValue));

        const [currentJSFilter, setCurrentJSFilter] = useState<FilterEntry | null>(null);

        const isCompacted = this.props.topic.cleanupPolicy === 'compact';

        const startOffsetOptions = [
            { value: PartitionOffsetOrigin.End, label: 'Newest' },
            { value: PartitionOffsetOrigin.EndMinusResults, label: 'Newest - ' + String(searchParams.maxResults) },
            { value: PartitionOffsetOrigin.Start, label: 'Oldest' },
            { value: PartitionOffsetOrigin.Custom, label: 'Custom' },
            { value: PartitionOffsetOrigin.Timestamp, label: 'Timestamp' }
        ];

        return (
            <React.Fragment>
                <Grid
                    my={4}
                    gap={3}
                    gridTemplateColumns="auto 1fr"
                    width="full"
                >
                    <GridItem display="flex" gap={3} gridColumn={{ base: '1/-1', xl: '1' }}>

                        <Label text="Start Offset">
                            <Flex gap={3}>
                                <SingleSelect<PartitionOffsetOrigin>
                                    value={searchParams.offsetOrigin}
                                    onChange={(e) => {
                                        searchParams.offsetOrigin = e;
                                        if (searchParams.offsetOrigin == PartitionOffsetOrigin.Custom) {
                                            if (searchParams.startOffset < 0) searchParams.startOffset = 0;
                                        } else {
                                            searchParams.startOffset = searchParams.offsetOrigin;
                                        }
                                    }}
                                    options={startOffsetOptions}
                                />
                                {searchParams.offsetOrigin == PartitionOffsetOrigin.Custom && (
                                    <Tooltip hasArrow placement="right" label="Offset must be a number" isOpen={!customStartOffsetValid}>
                                        <Input
                                            style={{ width: '7.5em' }}
                                            maxLength={20}
                                            isDisabled={searchParams.offsetOrigin != PartitionOffsetOrigin.Custom}
                                            value={customStartOffsetValue}
                                            onChange={(e) => {
                                                setCustomStartOffsetValue(e.target.value);
                                                if (!isNaN(Number(e.target.value))) searchParams.startOffset = Number(e.target.value);
                                            }}
                                        />
                                    </Tooltip>
                                )}
                                {searchParams.offsetOrigin == PartitionOffsetOrigin.Timestamp && <StartOffsetDateTimePicker />}
                            </Flex>
                        </Label>

                        <Label text="Max Results">
                            <SingleSelect<number> value={searchParams.maxResults} onChange={(c) => (searchParams.maxResults = c)} options={[1, 3, 5, 10, 20, 50, 100, 200, 500].map((i) => ({ value: i }))} />
                        </Label>

                        {uiState.topicSettings.dynamicFilters.map(filter => ({
                            partition: <Label text="Partition">
                                <RemovableFilter onRemove={() => {
                                    uiState.topicSettings.dynamicFilters.remove('partition');
                                    searchParams.partitionID = DEFAULT_SEARCH_PARAMS['partitionID'];
                                }}>
                                    <SingleSelect<number>
                                      value={searchParams.partitionID}
                                      chakraStyles={inlineSelectChakraStyles}
                                      onChange={(c) => (searchParams.partitionID = c)}
                                      options={[{
                                          value: -1,
                                          label: 'All'
                                      }].concat(range(0, topic.partitionCount).map((i) => ({
                                          value: i,
                                          label: String(i)
                                      })))}
                                    />
                                </RemovableFilter>
                            </Label>,
                            keyDeserializer: <Label text="Key Deserializer">
                                <RemovableFilter onRemove={() => {
                                    uiState.topicSettings.dynamicFilters.remove('keyDeserializer');
                                    searchParams.keyDeserializer = DEFAULT_SEARCH_PARAMS['keyDeserializer'];
                                }}>
                                    <SingleSelect<PayloadEncoding>
                                      chakraStyles={inlineSelectChakraStyles}
                                      options={payloadEncodingPairs}
                                      value={searchParams.keyDeserializer}
                                      onChange={e => searchParams.keyDeserializer = e}
                                    />
                                </RemovableFilter>
                            </Label>,
                            valueDeserializer: <Label text="Value Deserializer">
                                <RemovableFilter onRemove={() => {
                                    uiState.topicSettings.dynamicFilters.remove('valueDeserializer');
                                    searchParams.valueDeserializer = DEFAULT_SEARCH_PARAMS['valueDeserializer'];
                                }}>
                                    <SingleSelect<PayloadEncoding>
                                      chakraStyles={inlineSelectChakraStyles}
                                      options={payloadEncodingPairs}
                                      value={searchParams.valueDeserializer}
                                      onChange={e => searchParams.valueDeserializer = e}
                                    />
                                </RemovableFilter>
                            </Label>,
                            search: <Label text="Search">
                                <RemovableFilter onRemove={() => {
                                    uiState.topicSettings.dynamicFilters.remove('search');
                                    uiState.topicSettings.quickSearch = '';
                                }}>
                                    {/* Quick Search */}
                                    <Input
                                      px={4}
                                      variant="unstyled"
                                      placeholder="Search..."
                                      value={uiState.topicSettings.quickSearch}
                                      onChange={x => (uiState.topicSettings.quickSearch = x.target.value)}
                                    />
                                </RemovableFilter>
                            </Label>
                        })[filter])}

                        <Flex alignItems="flex-end">
                            <Menu>
                                <MenuButton as={Button} leftIcon={<MdAdd size="1.5rem"/>} variant="outline">
                                    Add
                                </MenuButton>
                                <MenuList>
                                    <MenuItem
                                      icon={<MdOutlineLayers size="1.5rem" />}
                                      isDisabled={uiState.topicSettings.dynamicFilters.includes('partition')}
                                      onClick={() => uiState.topicSettings.dynamicFilters.pushDistinct('partition')}
                                    >
                                        Partition
                                    </MenuItem>
                                    <MenuItem
                                      icon={<MdOutlineRoundedCorner size="1.5rem" />}
                                      isDisabled={uiState.topicSettings.dynamicFilters.includes('keyDeserializer')}
                                      onClick={() => uiState.topicSettings.dynamicFilters.pushDistinct('keyDeserializer')}
                                    >
                                        Key Deserializer
                                    </MenuItem>
                                    <MenuItem
                                      icon={<MdOutlineRoundedCorner size="1.5rem" />}
                                      isDisabled={uiState.topicSettings.dynamicFilters.includes('valueDeserializer')}
                                      onClick={() => uiState.topicSettings.dynamicFilters.pushDistinct('valueDeserializer')}
                                    >
                                        Value Deserializer
                                    </MenuItem>
                                    {isServerless() && <MenuItem
                                      icon={<MdOutlineSearch size="1.5rem" />}
                                      isDisabled={uiState.topicSettings.dynamicFilters.includes('search')}
                                      onClick={() => uiState.topicSettings.dynamicFilters.pushDistinct('search')}
                                    >
                                        Search
                                    </MenuItem>}
                                    <MenuDivider />
                                    <MenuItem
                                      isDisabled={!canUseFilters}
                                      // TODO: "You don't have permissions to use search filters in this topic",
                                      // we need support for disabledReason in @redpanda-data/ui
                                      icon={<MdJavascript size="1.5rem" />}
                                      onClick={() => {
                                          const filter = new FilterEntry();
                                          filter.isNew = true;
                                          setCurrentJSFilter(filter);
                                      }}
                                    >
                                        Javascript Filter
                                    </MenuItem>
                                </MenuList>
                            </Menu>
                        </Flex>

                        {/* Search Progress Indicator: "Consuming Messages 30/30" */}
                        {Boolean(this.messageSearch.searchPhase && this.messageSearch.searchPhase.length > 0) &&
                            <StatusIndicator
                                identityKey="messageSearch"
                                fillFactor={(this.messageSearch.messages?.length ?? 0) / searchParams.maxResults}
                                statusText={this.messageSearch.searchPhase!}
                                progressText={`${this.messageSearch.messages?.length ?? 0} / ${searchParams.maxResults}`}
                                bytesConsumed={prettyBytes(this.messageSearch.bytesConsumed)}
                                messagesConsumed={String(this.messageSearch.totalMessagesConsumed)}
                            />
                        }
                    </GridItem>

                    {/*
                api.MessageSearchPhase && api.MessageSearchPhase.length > 0 && searchParams.filters.length>0 &&
                    <StatusIndicator
                        identityKey='messageSearch'
                        fillFactor={(api.Messages?.length ?? 0) / searchParams.maxResults}
                        statusText={api.MessageSearchPhase}
                        progressText={`${api.Messages?.length ?? 0} / ${searchParams.maxResults}`}
                        bytesConsumed={searchParams.filtersEnabled ? prettyBytes(api.MessagesBytesConsumed) : undefined}
                        messagesConsumed={searchParams.filtersEnabled ? String(api.MessagesTotalConsumed) : undefined}
                    />
                    */}

                    <GridItem display="flex" justifyContent="flex-end" alignItems="flex-end" gap={3}>
                        <Flex alignItems="flex-end">
                            {/* Refresh Button */}
                            {this.messageSearch.searchPhase == null && (
                              <Tooltip label="Repeat current search" placement="top" hasArrow>
                                  <Button variant="outline" onClick={() => this.searchFunc('manual')}>
                                      <SyncIcon size={20}/>
                                  </Button>
                              </Tooltip>
                            )}
                            {this.messageSearch.searchPhase != null && (
                              <Tooltip label="Stop searching" placement="top" hasArrow>
                                  <Button variant="solid" colorScheme="red" onClick={() => this.messageSearch.stopSearch()}
                                          style={{padding: 0, width: '48px'}}>
                                      <XCircleIcon size={20}/>
                                  </Button>
                              </Tooltip>
                            )}
                        </Flex>

                        <Menu>
                            <MenuButton as={Button} rightIcon={<MdExpandMore size="1.5rem" />} variant="outline">
                                Actions
                            </MenuButton>
                            <MenuList>
                                <MenuItem
                                  onClick={() => {
                                      appGlobal.history.push(`/topics/${encodeURIComponent(topic.topicName)}/produce-record`);
                                  }}
                                  isDisabled={!uiSettings.enableTopicOperations}
                                >
                                    {uiSettings.enableTopicOperations ? 'Produce Record' : <Tooltip placement="top" label="Disabled." hasArrow>Produce Record</Tooltip>}
                                </MenuItem>
                                {DeleteRecordsMenuItem('2', isCompacted, topic.allowedActions ?? [], () => (this.deleteRecordsModalAlive = this.deleteRecordsModalVisible = true))}
                            </MenuList>
                        </Menu>

                    </GridItem>

                    {/* Filter Tags */}
                    <MessageSearchFilterBar messageSearch={this.messageSearch} onEdit={(filter) => {
                        setCurrentJSFilter(filter);
                    }}/>

                </Grid>

                {currentJSFilter && <JavascriptFilterModal
                  currentFilter={currentJSFilter}
                  onClose={() => setCurrentJSFilter(null)}
                  onSave={(filter) => {
                      if(filter.isNew) {
                          uiState.topicSettings.searchParams.filters.push(filter);
                          filter.isNew = false
                      } else {
                          const idx = uiState.topicSettings.searchParams.filters.findIndex(x => x.id === filter.id)
                          if(idx !== -1) {
                              uiState.topicSettings.searchParams.filters.splice(idx, 1, filter)
                          }
                      }
                      this.searchFunc('manual')
                  }}
                />}

            </React.Fragment>
        );
    });

    searchFunc = (source: 'auto' | 'manual') => {
        // need to do this first, so we trigger mobx
        const params = uiState.topicSettings.searchParams;
        const searchParams = `${params.offsetOrigin} ${params.maxResults} ${params.partitionID} ${params.startOffset} ${params.startTimestamp} ${params.keyDeserializer} ${params.valueDeserializer}`;

        untracked(() => {
            const phase = this.messageSearch.searchPhase;

            if (searchParams == this.currentSearchRun && source == 'auto') {
                console.log('ignoring serach, search params are up to date, and source is auto', {
                    newParams: searchParams,
                    oldParams: this.currentSearchRun,
                    currentSearchPhase: phase,
                    trigger: source
                });
                return;
            }

            // Abort current search if one is running
            if (phase != 'Done') {
                this.messageSearch.stopSearch();
            }

            console.log('starting a new message search', {
                newParams: searchParams,
                oldParams: this.currentSearchRun,
                currentSearchPhase: phase,
                trigger: source
            });

            // Start new search
            this.currentSearchRun = searchParams;
            try {
                this.executeMessageSearch()
                    .finally(() => {
                        untracked(() => {
                            this.currentSearchRun = null
                        })
                    });

            } catch (err) {
                console.error('error in message search', { error: err });
            }
        });
    };

    cancelSearch = () => this.messageSearch.stopSearch();

    isFilterMatch(str: string, m: TopicMessage) {
        str = uiState.topicSettings.quickSearch.toLowerCase();
        if (m.offset.toString().toLowerCase().includes(str)) return true;
        if (m.keyJson && m.keyJson.toLowerCase().includes(str)) return true;
        if (m.valueJson && m.valueJson.toLowerCase().includes(str)) return true;
        return false;
    }

    async loadLargeMessage(topicName: string, partitionID: number, offset: number) {

        // Create a new search that looks for only this message specifically
        const search = createMessageSearch();
        const searchReq: MessageSearchRequest = {
            filterInterpreterCode: '',
            maxResults: 1,
            partitionId: partitionID,
            startOffset: offset,
            startTimestamp: 0,
            topicName: topicName,
            includeRawPayload: true,
            ignoreSizeLimit: true,
            keyDeserializer: uiState.topicSettings.searchParams.keyDeserializer,
            valueDeserializer: uiState.topicSettings.searchParams.valueDeserializer,
        };
        const messages = await search.startSearch(searchReq);

        if (messages && messages.length == 1) {
            // We must update the old message (that still says "payload too large")
            // So we just find its index and replace it in the array we are currently displaying
            const indexOfOldMessage = this.messageSearch.messages.findIndex(x => x.partitionID == partitionID && x.offset == offset);
            if (indexOfOldMessage > -1) {
                this.messageSearch.messages[indexOfOldMessage] = messages[0];
            } else {
                console.error('LoadLargeMessage: cannot find old message to replace', {
                    searchReq,
                    messages
                });
                throw new Error('LoadLargeMessage: Cannot find old message to replace (message results must have changed since the load was started)');
            }
        } else {
            console.error('LoadLargeMessage: messages response is empty', { messages });
            throw new Error('LoadLargeMessage: Couldn\'t load the message content, the response was empty');
        }
    }

    @computed
    get activePreviewTags(): PreviewTagV2[] {
        return uiState.topicSettings.previewTags.filter(t => t.isActive);
    }

    MessageTable = observer(() => {
        const toast = useToast();
        const breakpoint = useBreakpoint({ ssr: false })
        const paginationParams = usePaginationParams(uiState.topicSettings.searchParams.pageSize, this.messageSource.data.length)

        const tsFormat = uiState.topicSettings.previewTimestamps;
        const hasKeyTags = uiState.topicSettings.previewTags.count(x => x.isActive && x.searchInMessageKey) > 0;

        function onCopyValue(original: TopicMessage) {
            navigator.clipboard.writeText(getPayloadAsString(original.value.payload ?? original.value.rawBytes)).then(() => {
                toast({
                    status: 'success',
                    description: 'Value copied to clipboard'
                });
            }).catch(navigatorClipboardErrorHandler);
        }

        function onCopyKey(original: TopicMessage) {
            navigator.clipboard.writeText(getPayloadAsString(original.key.payload ?? original.key.rawBytes)).then(() => {
                toast({
                    status: 'success',
                    description: 'Key copied to clipboard'
                });
            }).catch(navigatorClipboardErrorHandler);
        }

        const dataTableColumns: Record<DataColumnKey, ColumnDef<TopicMessage>> = {
            offset: {
                header: 'Offset',
                accessorKey: 'offset',
                cell: ({ row: { original: { offset } } }) => numberToThousandsString(offset)
            },
            partitionID: {
                header: 'Partition',
                accessorKey: 'partitionID',
            },
            timestamp: {
                header: 'Timestamp',
                accessorKey: 'timestamp',
                cell: ({ row: { original: { timestamp } } }) => <TimestampDisplay unixEpochMillisecond={timestamp} format={tsFormat} />,
            },
            key: {
                header: 'Key',
                size: hasKeyTags ? 300 : 1,
                accessorKey: 'key',
                cell: ({ row: { original } }) => <MessageKeyPreview msg={original} previewFields={() => this.activePreviewTags} />,
            },
            value: {
                header: () => 'Value',
                accessorKey: 'value',
                cell: ({ row: { original } }) => <MessagePreview msg={original} previewFields={() => this.activePreviewTags} isCompactTopic={this.props.topic.cleanupPolicy.includes('compact')} />
            },
            keySize: {
                header: 'Key Size',
                accessorKey: 'key.size',
                cell: ({ row: { original: { key: { size } } } }) => <span>{prettyBytes(size)}</span>,
            },
            valueSize: {
                header: 'Value Size',
                accessorKey: 'value.size',
                cell: ({ row: { original: { value: { size } } } }) => <span>{prettyBytes(size)}</span>,
            }
        }

        const columnsVisibleByDefault: DataColumnKey[] = ['offset', 'partitionID', 'timestamp', 'key', 'value']

        const newColumns: ColumnDef<TopicMessage>[] = columnsVisibleByDefault.map(key => dataTableColumns[key])

        if (uiState.topicSettings.previewColumnFields.length > 0) {
            newColumns.splice(0, newColumns.length);

            // let's be defensive and remove any duplicates before showing in the table
            new Set(uiState.topicSettings.previewColumnFields.map(field => field.dataIndex)).forEach(dataIndex => {
                if (dataTableColumns[dataIndex]) {
                    newColumns.push(dataTableColumns[dataIndex])
                }
            })
        }

        if (newColumns.length > 0) {
            newColumns[newColumns.length - 1].size = Infinity
        }

        const columns: ColumnDef<TopicMessage>[] = [...newColumns, {
            header: () => <button onClick={() => {
                this.showColumnSettings = true
            }}><CogIcon style={{ width: 20 }} />
            </button>,
            id: 'action',
            size: 0,
            cell: ({ row: { original } }) => {
                return (
                  <Menu computePositionOnMount>
                      <MenuButton as={Button} variant="link" className="iconButton">
                          <KebabHorizontalIcon/>
                      </MenuButton>
                      <MenuList>
                          <MenuItem onClick={() => {
                              navigator.clipboard.writeText(getMessageAsString(original)).then(() => {
                                  toast({
                                      status: 'success',
                                      description: 'Message copied to clipboard'
                                  });
                              }).catch(navigatorClipboardErrorHandler);
                          }}>
                              Copy Message
                          </MenuItem>
                          <MenuItem isDisabled={original.key.isPayloadNull} onClick={() => onCopyKey(original)}>
                              Copy Key
                          </MenuItem>
                          <MenuItem isDisabled={original.value.isPayloadNull} onClick={() => onCopyValue(original)}>
                              Copy Value
                          </MenuItem>
                          <MenuItem onClick={() => {
                              navigator.clipboard.writeText(original.timestamp.toString()).then(() => {
                                  toast({
                                      status: 'success',
                                      description: 'Epoch Timestamp copied to clipboard'
                                  });
                              }).catch(navigatorClipboardErrorHandler);
                          }}>
                              Copy Epoch Timestamp
                          </MenuItem>
                          <MenuItem onClick={() => this.downloadMessages = [original]}>
                              Save to File
                          </MenuItem>
                      </MenuList>
                  </Menu>
                );
            },
        }]

        return <>
            <DataTable<TopicMessage>
                size={['lg', 'md', 'sm'].includes(breakpoint) ? 'sm' : 'md'}
                data={this.messageSource.data}
                isLoading={this.messageSearch.searchPhase !== null}
                emptyText="No messages"
                columns={columns}
                // we need (?? []) to be compatible with searchParams of clients already stored in local storage
                // otherwise we would get undefined for some of the existing ones
                sorting={uiState.topicSettings.searchParams.sorting ?? []}
                onSortingChange={sorting => {
                    uiState.topicSettings.searchParams.sorting = typeof sorting === 'function' ? sorting(uiState.topicSettings.searchParams.sorting) : sorting
                }}
                pagination={paginationParams}
                onPaginationChange={onPaginationChange(paginationParams, ({ pageSize, pageIndex }) => {
                    uiState.topicSettings.searchParams.pageSize = pageSize
                    editQuery(query => {
                        query['page'] = String(pageIndex)
                        query['pageSize'] = String(pageSize)
                    })
                })}
                subComponent={({ row: { original } }) => <ExpandedMessage
                    msg={original}
                    loadLargeMessage={() => this.loadLargeMessage(this.props.topic.topicName, original.partitionID, original.offset)}
                    onDownloadRecord={() => this.downloadMessages = [original]}
                    onCopyKey={onCopyKey}
                  />
                }
            />
            <Button
              mt={4}
              variant="outline"
                onClick={() => {
                    this.downloadMessages = this.messageSearch.messages;
                }}
                isDisabled={!this.messageSearch.messages || this.messageSearch.messages.length == 0}
            >
                <span style={{ paddingRight: '4px' }}><DownloadIcon /></span>
                Save Messages
            </Button>

            <SaveMessagesDialog messages={this.downloadMessages} onClose={() => this.downloadMessages = null} onRequireRawPayload={() => this.executeMessageSearch()} />

            <ColumnSettings
              getShowDialog={() => this.showColumnSettings}
              setShowDialog={s => this.showColumnSettings = s}
              messageSearch={this.messageSearch}
              showPreviewSettings={this.messageSource?.data?.length > 0}
            />
        </>;
    });



    @action toggleRecordExpand(r: TopicMessage) {
        const key = r.offset + ' ' + r.partitionID + r.timestamp;
        // try collapsing it, removeAll returns the number of matches
        const removed = this.expandedKeys.removeAll(x => x == key);
        if (removed == 0) // wasn't expanded, so expand it now
            this.expandedKeys.push(key);
    }

    async executeMessageSearch(): Promise<TopicMessage[]> {
        const searchParams = uiState.topicSettings.searchParams;
        const canUseFilters = (api.topicPermissions.get(this.props.topic.topicName)?.canUseSearchFilters ?? true) && !isServerless();

        editQuery(query => {
            query['p'] = String(searchParams.partitionID); // p = partition
            query['s'] = String(searchParams.maxResults); // s = size
            query['o'] = String(searchParams.startOffset); // o = offset
        });

        let filterCode: string = '';
        if (canUseFilters) {
            const functionNames: string[] = [];
            const functions: string[] = [];

            searchParams.filters.filter(e => e.isActive && e.code && e.transpiledCode).forEach(e => {
                const name = `filter${functionNames.length + 1}`;
                functionNames.push(name);
                functions.push(`function ${name}() {
                    ${wrapFilterFragment(e.transpiledCode)}
                }`);
            });

            if (functions.length > 0) {
                filterCode = functions.join('\n\n') + '\n\n'
                    + `return ${functionNames.map(f => f + '()').join(' && ')}`;
                if (IsDev) console.log(`constructed filter code (${functions.length} functions)`, '\n\n' + filterCode);
            }
        }

        const request = {
            topicName: this.props.topic.topicName,
            partitionId: searchParams.partitionID,
            startOffset: searchParams.startOffset,
            startTimestamp: searchParams.startTimestamp,
            maxResults: searchParams.maxResults,
            filterInterpreterCode: encodeBase64(sanitizeString(filterCode)),
            includeRawPayload: true,

            keyDeserializer: searchParams.keyDeserializer,
            valueDeserializer: searchParams.valueDeserializer,
        } as MessageSearchRequest;

        // if (typeof searchParams.startTimestamp != 'number' || searchParams.startTimestamp == 0)
        //     console.error("startTimestamp is not valid", { request: request, searchParams: searchParams });

        return transaction(async () => {
            try {
                this.fetchError = null;
                return this.messageSearch.startSearch(request).catch(err => {
                    const msg = ((err as Error).message ?? String(err));
                    console.error('error in searchTopicMessages: ' + msg);
                    this.fetchError = err;
                    return [];

                });
            } catch (error: any) {
                console.error('error in searchTopicMessages: ' + ((error as Error).message ?? String(error)));
                this.fetchError = error;
                return [];
            }
        });
    }

    empty = () => {
        const searchParams = uiState.topicSettings.searchParams;
        const filterCount = searchParams.filters.filter(x => x.isActive).length;

        const hints: JSX.Element[] = [];
        if (filterCount > 0)
            hints.push(<>There are <b>{filterCount} filters</b> in use by the current search. Keep in mind that messages must pass <b>every</b> filter when using more than one filter at the same time.</>);
        if (searchParams.startOffset == PartitionOffsetOrigin.End)
            hints.push(<><b>Start offset</b> is set to "Newest". Make sure messages are being sent to the topic.</>);

        const hintBox = hints.length ? <ul className={styles.noMessagesHint}>
            {hints.map((x, i) => <li key={i}>{x}</li>)}
        </ul> : null;

        return (
            <VStack gap={4}>
                <Empty description="No messages" />
                {hintBox}
            </VStack>
        );
    };
}

@observer
class SaveMessagesDialog extends Component<{
    messages: TopicMessage[] | null,
    onClose: () => void,
    onRequireRawPayload: () => Promise<TopicMessage[]>
}> {
    @observable isOpen = false;
    @observable format = 'json' as 'json' | 'csv';
    @observable includeRawContent = false;

    radioStyle = { display: 'block', lineHeight: '30px' };

    constructor(p: any) {
        super(p);
        makeObservable(this);
    }

    render() {
        const { messages, onClose } = this.props;
        const count = (messages?.length ?? 0);
        const title = count > 1 ? 'Save Messages' : 'Save Message';

        // Keep dialog open after closing it, so it can play its closing animation
        if (count > 0 && !this.isOpen) setTimeout(() => this.isOpen = true);
        if (this.isOpen && count == 0) setTimeout(() => this.isOpen = false);


        return (
            <Modal isOpen={count > 0} onClose={onClose}>
                <ModalOverlay />
                <ModalContent minW="2xl">
                    <ModalHeader>{title}</ModalHeader>
                    <ModalBody display="flex" flexDirection="column" gap="4">
                        <div>Select the format in which you want to save {count == 1 ? 'the message' : 'all messages'}</div>
                        <Box py={2}>
                            <RadioGroup
                                name="format"
                                value={this.format}
                                onChange={value => this.format = value}
                                options={[
                                    {
                                        value: 'json',
                                        label: 'JSON'
                                    },
                                    {
                                        value: 'csv',
                                        label: 'CSV',
                                        disabled: true
                                    }
                                ]}
                            />
                        </Box>
                        <Checkbox isChecked={this.includeRawContent} onChange={e => this.includeRawContent = e.target.checked}>
                            Include raw data
                        </Checkbox>
                    </ModalBody>
                    <ModalFooter gap={2}>
                        <Button variant="outline" colorScheme="red" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button variant="solid" onClick={() => this.saveMessages()} isDisabled={!this.props.messages || this.props.messages.length == 0}>
                            Save Messages
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        )
    }

    async saveMessages() {
        const messages = this.props.messages;
        if (!messages)
            return;


        const cleanMessages = this.cleanMessages(messages);

        console.log('saving cleaned messages; messages: ' + messages.length);

        const json = toJson(cleanMessages, 4);

        const link = document.createElement('a');
        const file = new Blob([json], { type: 'application/json' });
        link.href = URL.createObjectURL(file);
        link.download = 'messages.json';
        document.body.appendChild(link); // required in firefox
        link.click();

        this.props.onClose();
    }

    cleanMessages(messages: TopicMessage[]): any[] {
        const ar: any[] = [];

        // create a copy of each message, omitting properties that don't make
        // sense for the user, like 'size' or caching properties like 'keyJson'.
        const includeRaw = this.includeRawContent;

        const cleanPayload = function (p: Payload): Payload {
            if (!p) return undefined as any;

            const cleanedPayload = {
                payload: p.payload,
                rawPayload: (includeRaw && p.rawBytes)
                    ? base64FromUInt8Array(p.rawBytes)
                    : undefined,
                encoding: p.encoding,
            } as any as Payload;

            if (p.schemaId && p.schemaId != 0)
                cleanedPayload.schemaId = p.schemaId;

            return cleanedPayload;
        };

        for (const src of messages) {
            const msg = {} as Partial<typeof src>;

            msg.partitionID = src.partitionID;
            msg.offset = src.offset;
            msg.timestamp = src.timestamp;
            msg.compression = src.compression;
            msg.isTransactional = src.isTransactional;

            msg.headers = src.headers.map(h => ({
                key: h.key,
                value: cleanPayload(h.value),
            }));

            msg.key = cleanPayload(src.key);
            msg.value = cleanPayload(src.value);

            ar.push(msg);
        }

        return ar;
    }
}


@observer
class MessageKeyPreview extends Component<{ msg: TopicMessage, previewFields: () => PreviewTagV2[]; }> {
    render() {
        const msg = this.props.msg;
        const key = msg.key;

        const isPrimitive =
            typeof key.payload === 'string' ||
            typeof key.payload === 'number' ||
            typeof key.payload === 'boolean';
        try {
            if (key.isPayloadNull)
                return renderEmptyIcon('Key is null');
            if (key.payload == null || key.payload.length == 0)
                return null;

            let text: ReactNode = <></>;

            if (key.encoding == 'binary') {
                text = cullText(msg.keyBinHexPreview, 44);
            }
            else if (key.encoding == 'utf8WithControlChars') {
                text = highlightControlChars(key.payload);
            }
            else if (isPrimitive) {
                text = cullText(key.payload, 44);
            }
            else {
                // Only thing left is 'object'
                // Stuff like 'bigint', 'function', or 'symbol' would not have been deserialized
                const previewTags = this.props.previewFields().filter(t => t.searchInMessageValue);
                if (previewTags.length > 0) {
                    const tags = getPreviewTags(key.payload, previewTags);
                    text = <span className="cellDiv fade" style={{ fontSize: '95%' }}>
                        <div className={'previewTags previewTags-' + uiState.topicSettings.previewDisplayMode}>
                            {tags.map((t, i) => <React.Fragment key={i}>{t}</React.Fragment>)}
                        </div>
                    </span>;
                    return text;
                }
                // Normal display (json, no filters). Just stringify the whole object
                text = cullText(JSON.stringify(key.payload), 44);
            }

            return <span className="cellDiv" style={{ minWidth: '10ch', width: 'auto', maxWidth: '45ch' }}>
                <code style={{ fontSize: '95%' }}>{text}</code>
            </span>;
        }
        catch (e) {
            return <span style={{ color: 'red' }}>Error in RenderPreview: {((e as Error).message ?? String(e))}</span>;
        }
    }
}


@observer
class StartOffsetDateTimePicker extends Component {

    constructor(p: any) {
        super(p);
        const searchParams = uiState.topicSettings.searchParams;
        // console.log('time picker 1', { setByUser: searchParams.startTimestampWasSetByUser, startTimestamp: searchParams.startTimestamp, format: new Date(searchParams.startTimestamp).toLocaleDateString() })
        if (!searchParams.startTimestampWasSetByUser) {
            // so far, the user did not change the startTimestamp, so we set it to 'now'
            searchParams.startTimestamp = new Date().getTime();
        }
        // console.log('time picker 2', { setByUser: searchParams.startTimestampWasSetByUser, startTimestamp: searchParams.startTimestamp, format: new Date(searchParams.startTimestamp).toLocaleDateString() })
    }

    render() {
        const searchParams = uiState.topicSettings.searchParams;
        // new Date().getTimezoneOffset()

        return (
            <DateTimeInput
                value={searchParams.startTimestamp}
                onChange={value => {
                    searchParams.startTimestamp = value
                    searchParams.startTimestampWasSetByUser = true;
                }}
            />
        )
    }
}

@observer
export class MessagePreview extends Component<{ msg: TopicMessage, previewFields: () => PreviewTagV2[]; isCompactTopic: boolean }> {
    render() {
        const msg = this.props.msg;
        const value = msg.value;

        if (value.troubleshootReport && value.troubleshootReport.length > 0) {
            return <Flex color="red.600" alignItems="center" gap="2">
                <WarningIcon fontSize="1.25em" />
                There were issues deserializing the value
            </Flex>
        }

        if (value.isPayloadTooLarge) {
            return <Flex color="blue.500" alignItems="center" gap="2">
                <InfoIcon fontSize="1.25em" />
                Message size exceeds the display limit.
            </Flex>
        }

        const isPrimitive =
            typeof value.payload === 'string' ||
            typeof value.payload === 'number' ||
            typeof value.payload === 'boolean';

        try {
            let text: ReactNode = <></>;

            if (value.isPayloadNull) {
                if (!this.props.isCompactTopic) {
                    return renderEmptyIcon('Value is null');
                }
                text = <><DeleteOutlined style={{ fontSize: 16, color: 'rgba(0,0,0, 0.35)', verticalAlign: 'text-bottom', marginRight: '4px', marginLeft: '1px' }} /><code>Tombstone</code></>;
            }
            else if (value.encoding == 'null' || value.payload == null || value.payload.length == 0)
                return null;
            else if (msg.value.encoding == 'binary') {
                // If the original data was binary, display as hex dump
                text = msg.valueBinHexPreview;
            }
            else if (isPrimitive) {
                // If we can show the value as a primitive, do so.
                text = value.payload;
            }
            else {
                // Only thing left is 'object'
                // Stuff like 'bigint', 'function', or 'symbol' would not have been deserialized
                const previewTags = this.props.previewFields().filter(t => t.searchInMessageValue);
                if (previewTags.length > 0) {
                    const tags = getPreviewTags(value.payload, previewTags);
                    text = <span className="cellDiv fade" style={{ fontSize: '95%' }}>
                        <div className={'previewTags previewTags-' + uiState.topicSettings.previewDisplayMode}>
                            {tags.map((t, i) => <React.Fragment key={i}>{t}</React.Fragment>)}
                        </div>
                    </span>;
                    return text;

                }
                else {
                    // Normal display (json, no filters). Just stringify the whole object
                    text = cullText(JSON.stringify(value.payload), 300);
                }
            }

            return <code><span className="cellDiv" style={{ fontSize: '95%' }}>{text}</span></code>;
        }
        catch (e) {
            return <span style={{ color: 'red' }}>Error in RenderPreview: {((e as Error).message ?? String(e))}</span>;
        }
    }
}

export const ExpandedMessage: FC<{
    msg: TopicMessage;
    loadLargeMessage: () => Promise<void>;
    onDownloadRecord?: () => void;
    onCopyKey?: (original: TopicMessage) => void;
}> = ({msg, loadLargeMessage, onDownloadRecord, onCopyKey}) => {
    const bg = useColorModeValue('gray.50', 'gray.600');
    return <Box bg={bg} py={6} px={10}>
        <MessageMetaData msg={msg}/>
        <RpTabs
          variant="fitted"
          isFitted
          defaultIndex={1}
          items={[
              {
                  key: 'key',
                  name: <Box
                    minWidth="6rem">{msg.key===null || msg.key.size===0 ? 'Key':`Key (${prettyBytes(msg.key.size)})`}</Box>,
                  isDisabled: msg.key==null || msg.key.size==0,
                  component: <Box>
                      <TroubleshootReportViewer payload={msg.key}/>
                      <PayloadComponent
                        payload={msg.key}
                        loadLargeMessage={loadLargeMessage}
                      />
                  </Box>
              },
              {
                  key: 'value',
                  name: <Box minWidth="6rem">{msg.value===null || msg.value.size===0 ? 'Value':`Value (${prettyBytes(msg.value.size)})`}</Box>,
                  component: <>
                      <TroubleshootReportViewer payload={msg.value}/>
                      <PayloadComponent
                        payload={msg.value}
                        loadLargeMessage={loadLargeMessage}
                      />
                  </>
              },
              {
                  key: 'headers',
                  name: <Box minWidth="6rem">{msg.headers.length===0 ? 'Headers':`Headers (${msg.headers.length})`}</Box>,
                  isDisabled: msg.headers.length===0,
                  component: <MessageHeaders msg={msg}/>
              },
          ]}
        />
        <Flex gap={2} justifyContent="flex-end">
            {onCopyKey &&
              <Button variant="outline" onClick={() => onCopyKey(msg)} isDisabled={msg.key.isPayloadNull}>Copy Key</Button>}
            {onDownloadRecord && <Button variant="outline" onClick={onDownloadRecord}>Download Record</Button>}
        </Flex>
    </Box>;
};

const PayloadComponent = observer((p: {
    payload: Payload,
    loadLargeMessage: () => Promise<void>
}) => {
    const { payload, loadLargeMessage } = p;
    const toast = useToast();
    const [isLoadingLargeMessage, setLoadingLargeMessage] = useState(false);

    if (payload.isPayloadTooLarge) {
        return <Flex flexDirection="column" gap="4">
            <Flex alignItems="center" gap="2">
                Because this message size exceeds the display limit, loading it could cause performance degradation.
            </Flex>
            <Button
                variant="outline" width="10rem" size="small"
                data-testid="load-anyway-button"
                isLoading={isLoadingLargeMessage}
                loadingText="Loading..."
                onClick={() => {
                    setLoadingLargeMessage(true);
                    loadLargeMessage()
                        .catch(err => toast({
                            status: 'error',
                            description: (err instanceof Error) ? err.message : String(err)
                        }))
                        .finally(() => setLoadingLargeMessage(false));
                }}
            >
                Load anyway
            </Button>
        </Flex>
    }

    try {
        if (payload === null || payload === undefined || payload.payload === null || payload.payload === undefined)
            return <code>null</code>;

        const val = payload.payload;
        const isPrimitive =
            typeof val === 'string' ||
            typeof val === 'number' ||
            typeof val === 'boolean';

        if (payload.encoding == 'binary') {
            const mode = 'hex' as ('ascii' | 'raw' | 'hex');
            if (mode == 'raw') {
                return <code style={{ fontSize: '.85em', lineHeight: '1em', whiteSpace: 'normal' }}>{val}</code>;
            }
            else if (mode == 'hex') {
                const rawBytes = payload.rawBytes ?? payload.normalizedPayload;

                if (rawBytes) {
                    let result = '';
                    rawBytes.forEach((n) => {
                        result += n.toString(16).padStart(2, '0') + ' ';
                    });
                    return <code style={{ fontSize: '.85em', lineHeight: '1em', whiteSpace: 'normal' }}>{result}</code>;
                } else {
                    return <div>Raw bytes not available</div>;
                }
            }
            else {
                const str = String(val);
                let result = '';
                const isPrintable = /[\x20-\x7E]/;
                for (let i = 0; i < str.length; i++) {
                    let ch = String.fromCharCode(str.charCodeAt(i)); // str.charAt(i);
                    ch = isPrintable.test(ch) ? ch : '. ';
                    result += ch + ' ';
                }

                return <code style={{ fontSize: '.85em', lineHeight: '1em', whiteSpace: 'normal' }}>{result}</code>;
            }
        }

        // Decode payload from base64 and render control characters as code highlighted text, such as
        // `NUL`, `ACK` etc.
        if (payload.encoding == 'utf8WithControlChars') {
            const elements = highlightControlChars(val);

            return <div className="codeBox" data-testid="payload-content">{elements}</div>;
        }

        if (isPrimitive) {
            return <div className="codeBox" data-testid="payload-content">{String(val)}</div>;
        }

        return <KowlJsonView srcObj={val} />;
    }
    catch (e) {
        return <span style={{ color: 'red' }}>Error in RenderExpandedMessage: {((e as Error).message ?? String(e))}</span>;
    }
})


function highlightControlChars(str: string, maxLength?: number): JSX.Element[] {
    const elements: JSX.Element[] = [];
    // To reduce the number of JSX elements we try to append normal chars to a single string
    // until we hit a control character.
    let sequentialChars = '';
    let numChars = 0;

    for (const char of str) {
        const code = char.charCodeAt(0);
        if (code < 32) {
            if (sequentialChars.length > 0) {
                elements.push(<>{sequentialChars}</>)
                sequentialChars = ''
            }
            elements.push(<span className="controlChar">{getControlCharacterName(code)}</span>);
            if (code == 10)
                // LineFeed (\n) should be rendered properly
                elements.push(<br />);

        } else {
            sequentialChars += char;
        }

        if (maxLength != undefined) {
            numChars++;
            if (numChars >= maxLength)
                break;
        }
    }

    if (sequentialChars.length > 0)
        elements.push(<>{sequentialChars}</>);

    return elements;
}

function getControlCharacterName(code: number): string {
    switch (code) {
        case 0: return 'NUL';
        case 1: return 'SOH';
        case 2: return 'STX';
        case 3: return 'ETX';
        case 4: return 'EOT';
        case 5: return 'ENQ';
        case 6: return 'ACK';
        case 7: return 'BEL';
        case 8: return 'BS';
        case 9: return 'HT';
        case 10: return 'LF';
        case 11: return 'VT';
        case 12: return 'FF';
        case 13: return 'CR';
        case 14: return 'SO';
        case 15: return 'SI';
        case 16: return 'DLE';
        case 17: return 'DC1';
        case 18: return 'DC2';
        case 19: return 'DC3';
        case 20: return 'DC4';
        case 21: return 'NAK';
        case 22: return 'SYN';
        case 23: return 'ETB';
        case 24: return 'CAN';
        case 25: return 'EM';
        case 26: return 'SUB';
        case 27: return 'ESC';
        case 28: return 'FS';
        case 29: return 'GS';
        case 30: return 'RS';
        case 31: return 'US';
        default: return '';
    }
};

const TroubleshootReportViewer = observer((props: { payload: Payload; }) => {
    const report = props.payload.troubleshootReport;
    const [show, setShow] = useState(true);

    if (!report) return null;
    if (report.length == 0) return null;

    return <Box mb="4" mt="4">
        <Heading as="h4">Deserialization Troubleshoot Report</Heading>
        <Alert status="error" variant="subtle" my={4} flexDirection="column" background="red.50">
            <AlertTitle display="flex" flexDirection="row" alignSelf="flex-start" alignItems="center" pb="4" fontWeight="normal">
                <AlertIcon /> Errors were encountered when deserializing this message
                <Link pl="2" onClick={() => setShow(!show)} >{show ? 'Hide' : 'Show'}</Link>
            </AlertTitle>
            <AlertDescription whiteSpace="pre-wrap" display={show ? undefined : 'none'}>
                <Grid templateColumns="auto 1fr" rowGap="1" columnGap="4">
                    {report.map(e => <>
                        <GridItem key={e.serdeName + '-name'} w="100%" fontWeight="bold" textTransform="capitalize" py="2" px="5" pl="8">
                            {e.serdeName}
                        </GridItem>
                        <GridItem key={e.serdeName + '-message'} w="100%" fontFamily="monospace" background="red.100" py="2" px="5">
                            {e.message}
                        </GridItem>
                    </>)}
                </Grid>
            </AlertDescription>

        </Alert>


    </Box>

});

const MessageMetaData = observer((props: { msg: TopicMessage; }) => {
    const msg = props.msg;
    const data: { [k: string]: any } = {
        'Key': msg.key.isPayloadNull ? 'Null' : `${titleCase(msg.key.encoding)} (${prettyBytes(msg.key.size)})`,
        'Value': msg.value.isPayloadNull ? 'Null' : `${titleCase(msg.value.encoding)} (${msg.value.schemaId > 0 ? `${msg.value.schemaId} / ` : ''}${prettyBytes(msg.value.size)})`,
        'Headers': msg.headers.length > 0 ? `${msg.headers.length}` : 'No headers set',
        'Compression': msg.compression,
        'Transactional': msg.isTransactional ? 'true' : 'false',
        // "Producer ID": "(msg.producerId)",
    };

    if (msg.value.schemaId) {
        data['Schema'] = <MessageSchema schemaId={msg.value.schemaId} />
    }

    return <Flex gap={10} my={6}>
        {Object.entries(data).map(([k, v]) => (
                <Flex
                        key={k}
                        direction="column"
                        rowGap=".4em"
                >
                    <Text fontWeight="600" fontSize="md">{k}</Text>
                    <Text color="" fontSize="sm">{v}</Text>
                </Flex>
        ))}
    </Flex>
});

const MessageSchema = observer((p: { schemaId: number }) => {

    const subjects = api.schemaUsagesById.get(p.schemaId);
    if (!subjects || subjects.length == 0) {
        api.refreshSchemaUsagesById(p.schemaId);
        return <>
            ID {p.schemaId} (unknown subject)
        </>;
    }

    const s = subjects[0];
    return <>
        <Link as={ReactRouterLink} to={`/schema-registry/subjects/${encodeURIComponent(s.subject)}?version=${s.version}`}>
            {s.subject} (version {s.version})
        </Link>
    </>
});

const MessageHeaders = observer((props: { msg: TopicMessage; }) => {
    return <div className="messageHeaders">
        <div>
            <DataTable<{ key: string, value: Payload }>
                pagination
                sorting
                data={props.msg.headers}
                columns={[
                    {
                        size: 200, header: 'Key', accessorKey: 'key',
                        cell: ({ row: { original: { key: headerKey } } }) => <span className="cellDiv" style={{ width: 'auto' }}>
                            {headerKey
                                ? <Ellipsis>{toSafeString(headerKey)}</Ellipsis>
                                : renderEmptyIcon('Empty Key')}
                        </span>
                    },
                    {
                        size: Infinity, header: 'Value', accessorKey: 'value',
                        cell: ({ row: { original: { value: headerValue } } }) => {
                            if (typeof headerValue.payload === 'undefined') return renderEmptyIcon('"undefined"');
                            if (headerValue.payload === null) return renderEmptyIcon('"null"');
                            if (typeof headerValue.payload === 'number') return <span>{String(headerValue.payload)}</span>;

                            if (typeof headerValue.payload === 'string')
                                return <span className="cellDiv">{headerValue.payload}</span>;

                            // object
                            return <span className="cellDiv">{toSafeString(headerValue.payload)}</span>;
                        },
                    },
                    {
                        size: 120, header: 'Encoding', accessorKey: 'value',
                        cell: ({ row: { original: { value: payload } } }) => <span className="nowrap">{payload.encoding}</span>
                    },
                ]}

                subComponent={({ row: { original: header } }) => {
                    return <Box py={6} px={10}>{typeof header.value?.payload !== 'object'
                        ? <div className="codeBox" style={{ margin: '0', width: '100%' }}>{toSafeString(header.value.payload)}</div>
                      : <KowlJsonView srcObj={header.value.payload as object} style={{ margin: '2em 0' }} />}</Box>
                }}
            />
        </div>
    </div>;
});


const ColumnSettings: FC<{
    getShowDialog: () => boolean;
    setShowDialog: (val: boolean) => void;
    messageSearch: MessageSearch;
    showPreviewSettings: boolean;
}> = observer(({ getShowDialog, setShowDialog, messageSearch, showPreviewSettings }) => {

    return <Modal isOpen={getShowDialog()} onClose={() => {
        setShowDialog(false);
    }}>
        <ModalOverlay />
        <ModalContent minW="4xl">
            <ModalHeader>
                Column Settings
            </ModalHeader>
            <ModalCloseButton />
            <ModalBody>
                <Box>
                    <Text>
                        Click on the column field on the text field and/or <b>x</b> on to remove it.<br />
                    </Text>
                </Box>
                <Box py={6} px={4} bg="rgba(200, 205, 210, 0.16)" borderRadius="4px">
                    <ColumnOptions tags={uiState.topicSettings.previewColumnFields} />
                </Box>
                <Box mt="1em">
                    <Text mb={2}>More Settings</Text>
                    <Box>
                        <OptionGroup<TimestampDisplayFormat>
                            label="Timestamp"
                            options={{
                                'Local DateTime': 'default',
                                'Unix DateTime': 'unixTimestamp',
                                'Relative': 'relative',
                                'Local Date': 'onlyDate',
                                'Local Time': 'onlyTime',
                                'Unix Millis': 'unixMillis',
                            }}
                            value={uiState.topicSettings.previewTimestamps}
                            onChange={e => uiState.topicSettings.previewTimestamps = e}
                        />
                    </Box>
                </Box>

                <Box mt={10}>
                    {
                      showPreviewSettings &&
                      <PreviewSettings
                        messageSearch={messageSearch}
                      />
                    }
                </Box>
            </ModalBody>
            <ModalFooter gap={2}>
                <Button onClick={() => {
                    setShowDialog(false)
                }} colorScheme="red">Close</Button>
            </ModalFooter>
        </ModalContent>
    </Modal>
});


const handleColumnListChange = action((newValue: MultiValue<{ value: DataColumnKey, label: string }>) => {
    uiState.topicSettings.previewColumnFields = newValue.map(({ label, value }) => ({
        title: label,
        dataIndex: value
    }))
})


const ColumnOptions: FC<{ tags: ColumnList[] }> = ({ tags }) => {
    const defaultColumnList: ColumnList[] = [
        { title: 'Offset', dataIndex: 'offset' },
        { title: 'Partition', dataIndex: 'partitionID' },
        { title: 'Timestamp', dataIndex: 'timestamp' },
        { title: 'Key', dataIndex: 'key' },
        // { title: 'Headers', dataIndex: 'headers' },
        { title: 'Value', dataIndex: 'value' },
        { title: 'Key Size', dataIndex: 'keySize' }, // size of the whole message is not available (bc it was a bad guess), might be added back later
        { title: 'Value Size', dataIndex: 'valueSize' }, // size of the whole message is not available (bc it was a bad guess), might be added back later
    ];

    const value = tags.map(column => ({
        label: column.title,
        value: column.dataIndex
    }));

    return <Select
        isMulti
        name=""
        options={defaultColumnList.map((column: ColumnList) => ({
            label: column.title,
            value: column.dataIndex,
        }))}
        value={value}
        // @ts-ignore - we need to add support for isMulti generic in @redpanda-data/ui
        onChange={handleColumnListChange}
    />
}

const MessageSearchFilterBar: FC<{ messageSearch: MessageSearch, onEdit: (filter: FilterEntry) => void }> = observer(({ messageSearch, onEdit }) => {
  const settings = uiState.topicSettings.searchParams;

  return <GridItem gridColumn="-1/1" display="flex" justifyContent="space-between">
    <Box
      width="calc(100% - 200px)"
      display="inline-flex"
      rowGap="2px"
      columnGap="8px"
      flexWrap="wrap"
    >
      {/* Existing Tags List  */}
      {settings.filters?.map((e) =>
        <Tag
          style={{userSelect: 'none'}}
          className={e.isActive ? 'filterTag':'filterTag filterTagDisabled'}
          key={e.id}
        >
          <SettingOutlined
            className="settingIconFilter"
            onClick={() => {
                onEdit(e)
            }}
          />
          <TagLabel onClick={() => e.isActive = !e.isActive}
                    mx="2"
                    height="100%"
                    display="inline-flex"
                    alignItems="center"
                    border="0px solid hsl(0 0% 85% / 1)"
                    borderWidth="0px 1px"
                    px="6px"
                    textDecoration={e.isActive ? '':'line-through'}
          >
            {e.name ? e.name:(e.code ? e.code:'New Filter')}
          </TagLabel>
          <TagCloseButton onClick={() => settings.filters.remove(e)} m="0" px="1" opacity={1}/>
        </Tag>
      )}
    </Box>

      {messageSearch.searchPhase === null || messageSearch.searchPhase === 'Done'
        ? (
          <div className={styles.metaSection}>
              <span><DownloadOutlined className={styles.bytesIcon} /> {prettyBytes(messageSearch.bytesConsumed)}</span>
              <span className={styles.time}><ClockCircleOutlined className={styles.timeIcon} /> {messageSearch.elapsedMs ? prettyMilliseconds(messageSearch.elapsedMs) : ''}</span>
          </div>
        )
        : (
          <div className={`${styles.metaSection} ${styles.isLoading}`}>
              <span className={`spinner ${styles.spinner}`} />
              <span className={`pulsating ${styles.spinnerText}`}>Fetching data...</span>
          </div>
        )
      }
  </GridItem>;
});

function renderEmptyIcon(tooltipText?: string) {
    if (!tooltipText) tooltipText = 'Empty';
    return (
        <Tooltip label={tooltipText} openDelay={1} placement="top" hasArrow>
            <span style={{ opacity: 0.66, marginLeft: '2px' }}>
                <SkipIcon />
            </span>
        </Tooltip>
    );
}

function hasDeleteRecordsPrivilege(allowedActions: Array<TopicAction>) {
    return allowedActions.includes('deleteTopicRecords') || allowedActions.includes('all');
}

function DeleteRecordsMenuItem(key: string, isCompacted: boolean, allowedActions: Array<TopicAction>, onClick: () => void) {
    const isEnabled = uiSettings.enableTopicOperations && !isCompacted && hasDeleteRecordsPrivilege(allowedActions) && isSupported(Feature.DeleteRecords);

    let errorText: string | undefined;
    
    if (!uiSettings.enableTopicOperations) errorText = 'Disabled.';
    else if (isCompacted) errorText = 'Records on Topics with the \'compact\' cleanup policy cannot be deleted.';
    else if (!hasDeleteRecordsPrivilege(allowedActions)) errorText = 'You\'re not permitted to delete records on this topic.';
    else if (!isSupported(Feature.DeleteRecords)) errorText = 'The cluster doesn\'t support deleting records.';

    let content: JSX.Element | string = 'Delete Records';
    if (errorText)
        content = (
            <Tooltip label={errorText} placement="top" hasArrow>
                {content}
            </Tooltip>
        );

    return (
        <MenuItem key={key} isDisabled={!isEnabled} onClick={onClick}>
            {content}
        </MenuItem>
    );
}
