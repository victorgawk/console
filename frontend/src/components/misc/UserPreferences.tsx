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

import { ToolsIcon } from '@primer/octicons-react';
import { Alert, AlertDialog, AlertDialogBody, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogOverlay, AlertIcon, Button, Checkbox, Flex, IconButton, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, ModalOverlay, NumberInput, Tabs, Text, Tooltip, useToast } from '@redpanda-data/ui';
import { transaction } from 'mobx';
import { observer, useLocalObservable } from 'mobx-react';
import { cloneElement, Component, FC, useRef, useState } from 'react';
import { appGlobal } from '../../state/appGlobal';
import { api } from '../../state/backendApi';
import { Topic } from '../../state/restInterfaces';
import { clearSettings, uiSettings } from '../../state/ui';
import { Label, navigatorClipboardErrorHandler } from '../../utils/tsxUtils';

type SettingsTabKeys = 'statisticsBar' | 'jsonViewer' | 'importExport' | 'autoRefresh' | 'custom'

const settingsTabs: Record<SettingsTabKeys, { name: string, component: FC }> = {
    statisticsBar: {name: 'Statistics Bar', component: () => <StatsBarTab/>},
    jsonViewer: {name: 'Json Viewer', component: () => <JsonViewerTab/>},
    importExport: {name: 'Import/Export', component: () => <ImportExportTab/>},
    autoRefresh: {name: 'Auto Refresh', component: () => <AutoRefreshTab/>},
    custom: { name: 'Custom', component: () => <CustomTab /> },
    // pagination position
    // messageSearch: { name: "Message Search", component: () => <MessageSearchTab /> },
}


export const UserPreferencesButton: FC = () => {
    const [isOpen, setOpen] = useState<boolean>(false);
    return <>
        <UserPreferencesDialog isOpen={isOpen} onClose={() => setOpen(false)} />
        <IconButton
            className="hoverButton userPreferencesButton"
            variant="outline"
            aria-label="user preferences"
            icon={<ToolsIcon size={17} />}
            onClick={() => setOpen(true)}
        />
    </>;
}

export const UserPreferencesDialog: FC<{isOpen: boolean; onClose: () => void}> = ({isOpen, onClose}) =>
    (
        <Modal isCentered isOpen={isOpen} onClose={onClose}>
            <ModalOverlay/>
            <ModalContent minW="5xl" minH="50vh">
                <ModalHeader>User Preferences</ModalHeader>
                <ModalBody>
                    <Tabs
                        items={Object.entries(settingsTabs).map(([key, {name, component: Component}]) => ({
                            name,
                            component: <Component/>,
                            key,
                        }))}
                    />
                </ModalBody>
                <ModalFooter alignItems="center" justifyContent="flex-end" gap={2}>
                    <Text fontSize="xs" color="gray.500">
                        Changes are saved automatically
                    </Text>
                    <Button onClick={onClose}>Close</Button>
                </ModalFooter>
            </ModalContent>
        </Modal>
    )

@observer
class StatsBarTab extends Component {
    render() {
        return <div>
            <p>Controls on what pages Redpanda Console shows the statistics bar</p>
            <div style={{ display: 'inline-grid', gridAutoFlow: 'row', gridRowGap: '24px', gridColumnGap: '32px', marginRight: 'auto' }}>
                <Label text="Topic Details" >
                    <Checkbox children="Enabled" isChecked={uiSettings.topicDetailsShowStatisticsBar} onChange={e => uiSettings.topicDetailsShowStatisticsBar = e.target.checked} />
                </Label>
                <Label text="Consumer Group Details" >
                    <Checkbox children="Enabled" isChecked={uiSettings.consumerGroupDetails.showStatisticsBar} onChange={e => uiSettings.consumerGroupDetails.showStatisticsBar = e.target.checked} />
                </Label>
            </div>
        </div>;
    }
}

@observer
class JsonViewerTab extends Component {
    render() {
        const settings = uiSettings.jsonViewer;

        return <div>
            <p>Settings for the JsonViewer</p>

            <div style={{ display: 'inline-grid', gridAutoFlow: 'row', gridRowGap: '24px', gridColumnGap: '32px', marginRight: 'auto' }}>
                <Label text="Font Size">
                    <Input value={settings.fontSize} onChange={e => settings.fontSize = e.target.value} maxWidth={150} />
                </Label>
                <Label text="Line Height">
                    <Input value={settings.lineHeight} onChange={e => settings.lineHeight = e.target.value} maxWidth={150} />
                </Label>
                <Label text="Maximum string length before collapsing">
                    <NumberInput
                        value={settings.maxStringLength}
                        onChange={e => settings.maxStringLength = Number(e ?? 200)} min={0} max={10000}
                        maxWidth={150}/>
                </Label>
                <Label text="Maximum depth before collapsing nested objects">
                    <NumberInput value={settings.collapsed} onChange={e => settings.collapsed = Number(e ?? 2)} min={1} max={50} maxWidth={150} />
                </Label>
            </div>
        </div>;
    }
}

const ImportExportTab: FC = observer(() => {
    const toast = useToast()
    const $state = useLocalObservable<{
        importCode: string;
        resetConfirm: string;
    }>(() => ({
        importCode: '',
        resetConfirm: ''
    }))
    return <Flex flexDirection="column" gap={2}>
        <Label text="Import">
            <Flex gap={2}>
                <Input
                    maxWidth={360}
                    spellCheck={false}
                    placeholder="Paste a previously exported settings string..."
                    value={$state.importCode}
                    onChange={e => $state.importCode = e.target.value}
                />
                <Button onClick={() => {
                    try {
                        const data = JSON.parse($state.importCode);
                        const skipped: string[] = [];
                        transaction(() => {
                            for (const k in data) {
                                if (!Reflect.has(uiSettings, k))
                                    skipped.push(k);
                                else
                                    (uiSettings as any)[k] = data[k];
                            }
                        });
                        if (skipped.length > 0)
                            toast({
                                status: 'warning',
                                description: 'Some properties were skipped during import:\n' + skipped.join(', ')
                            })
                        else
                            toast({
                                status: 'success',
                                description: 'Settings imported successfully'
                            })
                        $state.importCode = '';
                    } catch (e) {
                        toast({
                            status: 'error',
                            description: 'Unable to import settings. See console for more information.'
                        })
                        console.error('unable to import settings', { error: e });
                    }

                }}>Import</Button>
            </Flex>
        </Label>

        <Label text="Export">
            <Button onClick={() => {
                navigator.clipboard.writeText(JSON.stringify(uiSettings)).then(() => {
                    toast({
                        status: 'success',
                        description: 'Preferences copied to clipboard!'
                    })
                }).catch(navigatorClipboardErrorHandler)
            }}>
                Export User Preferences
            </Button>
        </Label>

        <Label text="Reset">
            <Flex gap={2} alignItems="center">
                <Input
                    maxWidth={360}
                    spellCheck={false}
                    placeholder='type "reset" here to confirm and enable the button'
                    value={$state.resetConfirm}
                    onChange={str => $state.resetConfirm = str.target.value}
                />
                <Button onClick={() => {
                    clearSettings();
                    toast({
                        status: 'success',
                        description: 'All settings have been reset to their defaults'
                    });
                    $state.resetConfirm = '';
                }} colorScheme="red" isDisabled={$state.resetConfirm !== 'reset'}>Reset</Button>
                <span className="smallText">Clear all your user settings, resetting them to the default values</span>
            </Flex>
        </Label>
    </Flex>;
})

@observer
class AutoRefreshTab extends Component {
    render() {
        return <div>
            <p>Settings for the Auto Refresh Button</p>
            <div style={{ display: 'inline-grid', gridAutoFlow: 'row', gridRowGap: '24px', gridColumnGap: '32px', marginRight: 'auto' }}>
                <Label text="Interval in seconds">
                    <NumberInput
                        value={uiSettings.autoRefreshIntervalSecs}
                        onChange={e => {
                            if (e) {
                                uiSettings.autoRefreshIntervalSecs = Number(e);
                            }
                        }}
                        min={5} max={300}
                        maxWidth={150}
                    />
                </Label>
            </div>
        </div>;
    }
}

@observer
class CustomTab extends Component {
    render() {
        return <div>
            <div style={{ display: 'inline-grid', gridAutoFlow: 'row', gridRowGap: '24px', gridColumnGap: '32px', marginRight: 'auto' }}>
                <Label text="Topic Operations">
                    <Checkbox children="Enabled" checked={uiSettings.enableTopicOperations} onChange={e => {
                        uiSettings.enableTopicOperations = e.target.checked;
                        appGlobal.onRefresh();
                    }} />
                </Label>

                <Label text="Delete All Records">
                    <DeleteDisabledTooltip>
                        <Button
                            variant="solid"
                            colorScheme="brand"
                            onClick={(e) => {
                                e.stopPropagation();
                                uiSettings._deleteAllRecordsModalVisible = true;
                            }}
                        >
                            Delete All Records
                        </Button>
                    </DeleteDisabledTooltip>
                </Label>
                <ConfirmDeleteAllRecordsModal
                    deleteAllRecordsVisible={uiSettings._deleteAllRecordsModalVisible}
                    onCancel={() => (uiSettings._deleteAllRecordsModalVisible = false)}
                    onFinish={() => {
                        uiSettings._deleteAllRecordsModalVisible = false;
                        appGlobal.onRefresh();
                    }}
                />

                <Label text="Delete All Topics">
                    <DeleteDisabledTooltip>
                        <Button
                            variant="solid"
                            colorScheme="brand"
                            onClick={(e) => {
                                e.stopPropagation();
                                uiSettings._deleteAllTopicsModalVisible = true;
                            }}
                        >
                            Delete All Topics
                        </Button>
                    </DeleteDisabledTooltip>
                </Label>
                <ConfirmDeleteAllTopicsModal
                    deleteAllTopicsVisible={uiSettings._deleteAllTopicsModalVisible}
                    onCancel={() => (uiSettings._deleteAllTopicsModalVisible = false)}
                    onFinish={() => {
                        uiSettings._deleteAllTopicsModalVisible = false;
                        appGlobal.onRefresh();
                    }}
                />
            </div>
        </div>;
    }
}

function DeleteDisabledTooltip(props: { children: JSX.Element }): JSX.Element {
    const deleteButton = props.children;
    const wrap = (button: JSX.Element, message: string) => (
        <Tooltip placement="top" label={message}>
            {cloneElement(button, {
                isDisabled: true,
                className: (button.props.className ?? '') + ' disabled',
                onClick: undefined,
            })}
        </Tooltip>
    );
    return <>{uiSettings.enableTopicOperations ? deleteButton : wrap(deleteButton, 'Disabled.')}</>;
}

function ConfirmDeleteAllRecordsModal({ deleteAllRecordsVisible, onFinish, onCancel }: { deleteAllRecordsVisible: boolean; onFinish: () => void; onCancel: () => void }) {
    const [deletionPending, setDeletionPending] = useState(false);
    const [error, setError] = useState<string | Error | null>(null);
    const toast = useToast()
    const cancelRef = useRef<HTMLButtonElement | null>(null)


    const cleanup = () => {
        setDeletionPending(false);
        setError(null);
    };

    const finish = () => {
        onFinish();
        cleanup();

        toast({
            title: 'Records Deleted',
            description: <Text as="span">Records from all topics deleted successfully</Text>,
            status: 'success',
        })
    };

    const cancel = () => {
        onCancel();
        cleanup();
    };

    return (
        <AlertDialog
            isOpen={deleteAllRecordsVisible}
            leastDestructiveRef={cancelRef}
            onClose={cancel}
        >
            <AlertDialogOverlay>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        Delete Topic
                    </AlertDialogHeader>

                    <AlertDialogBody>
                        {error && <Alert status="error" mb={2}>
                            <AlertIcon/>
                            {`An error occurred: ${typeof error === 'string' ? error : error.message}`}
                        </Alert>}
                        <Text>
                            Are you sure you want to delete all records from all topics?<br/>
                            This action cannot be undone.
                        </Text>
                    </AlertDialogBody>

                    <AlertDialogFooter>
                        <Button ref={cancelRef} onClick={cancel} variant="ghost">
                            Cancel
                        </Button>
                        <Button
                            data-testid="delete-topic-confirm-button"
                            isLoading={deletionPending} colorScheme="brand" onClick={() => {

                            setDeletionPending(true);

                            api.refreshTopics();
                            api.refreshPartitions()
                            .then(() => {
                                if (api.topics == null) {
                                    setDeletionPending(false);
                                    return Promise.resolve().then(() => {
                                        return [];
                                    });
                                }
                                const promises: Array<Promise<{topic: Topic; errors: Array<string>}>> = []
                                for (const topic of api.topics) {
                                    const promise = api.deleteTopicRecordsFromAllPartitionsHighWatermark(topic.topicName).then((responseData) => {
                                        const errors: Array<string> = [];
                                        if (responseData == null) {
                                            errors.push(`Topic ${topic.topicName} doesn't have partitions.`);
                                        } else {
                                            const errorPartitions = responseData.partitions.filter((partition) => !!partition.error);
                                            if (errorPartitions.length > 0) {
                                                errors.concat(errorPartitions.map(({ partitionId, error }) => `Topic ${topic.topicName} partition ${partitionId}: ${error}`));
                                            }
                                        }
                                        return { topic, errors };
                                    });
                                    promises.push(promise);
                                }
            
                                return Promise.all(promises)
                                .then((responses) => {
                                    const errors: Array<string> = [];
                                    for (const response of responses) {
                                        errors.concat(response.errors);
                                    }
                                    return errors;
                                })
                            })
                                .then(finish)
                                .catch(setError)
                                .finally(() => {
                                    setDeletionPending(false)
                                });
                        }} ml={3}>
                            Delete
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialogOverlay>
        </AlertDialog>
    )
}

function ConfirmDeleteAllTopicsModal({ deleteAllTopicsVisible, onFinish, onCancel }: { deleteAllTopicsVisible: boolean; onFinish: () => void; onCancel: () => void }) {
    const [deletionPending, setDeletionPending] = useState(false);
    const [error, setError] = useState<string | Error | null>(null);
    const toast = useToast()
    const cancelRef = useRef<HTMLButtonElement | null>(null)


    const cleanup = () => {
        setDeletionPending(false);
        setError(null);
    };

    const finish = () => {
        onFinish();
        cleanup();

        toast({
            title: 'Topics Deleted',
            description: <Text as="span">Topics deleted successfully</Text>,
            status: 'success',
        })
    };

    const cancel = () => {
        onCancel();
        cleanup();
    };

    return (
        <AlertDialog
            isOpen={deleteAllTopicsVisible}
            leastDestructiveRef={cancelRef}
            onClose={cancel}
        >
            <AlertDialogOverlay>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        Delete Topic
                    </AlertDialogHeader>

                    <AlertDialogBody>
                        {error && <Alert status="error" mb={2}>
                            <AlertIcon/>
                            {`An error occurred: ${typeof error === 'string' ? error : error.message}`}
                        </Alert>}
                        <Text>
                            Are you sure you want to delete all topics?<br/>
                            This action cannot be undone.
                        </Text>
                    </AlertDialogBody>

                    <AlertDialogFooter>
                        <Button ref={cancelRef} onClick={cancel} variant="ghost">
                            Cancel
                        </Button>
                        <Button
                            data-testid="delete-topic-confirm-button"
                            isLoading={deletionPending} colorScheme="brand" onClick={() => {

                            setDeletionPending(true);

                            api.refreshTopics();
                            api.refreshPartitions()
                            .then(() => {
                                if (api.topics == null) {
                                    setDeletionPending(false);
                                    return Promise.resolve().then(() => {
                                        return [];
                                    });
                                }
                                const promises: Array<Promise<{topic: Topic; errors: Array<string>}>> = []
                                for (const topic of api.topics) {
                                    const promise = api.deleteTopic(topic.topicName).then((responseData) => {
                                        const errors: Array<string> = [];
                                        if (responseData == null) {
                                            errors.push(`Error when deleting topic ${topic.topicName}.`);
                                        }
                                        return { topic, errors };
                                    });
                                    promises.push(promise);
                                }
            
                                return Promise.all(promises)
                                .then((responses) => {
                                    const errors: Array<string> = [];
                                    for (const response of responses) {
                                        errors.concat(response.errors);
                                    }
                                    return errors;
                                })
                            })
                                .then(finish)
                                .catch(setError)
                                .finally(() => {
                                    setDeletionPending(false)
                                });
                        }} ml={3}>
                            Delete
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialogOverlay>
        </AlertDialog>
    )
}
