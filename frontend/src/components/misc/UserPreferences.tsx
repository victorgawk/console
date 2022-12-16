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

import { Component, ReactNode, useState } from 'react';
import { observer } from 'mobx-react';
import { Menu, Button, Modal, Input, message, Checkbox, InputNumber, Tooltip, Alert, notification } from 'antd';
import { clearSettings, uiSettings } from '../../state/ui';
import { findPopupContainer, Label } from '../../utils/tsxUtils';
import { makeObservable, observable, transaction } from 'mobx';
import { ToolsIcon } from '@primer/octicons-react';
import React from 'react';
import { api } from '../../state/backendApi';
import { appGlobal } from '../../state/appGlobal';
import { ShowBulkDeleteButtons } from '../../utils/env';
import { Topic } from '../../state/restInterfaces';

type Action = () => void;

const settingsTabs: { name: string, component: () => ReactNode }[] = [
    { name: 'Statistics Bar', component: () => <StatsBarTab /> },
    { name: 'Json Viewer', component: () => <JsonViewerTab /> },
    { name: 'Import/Export', component: () => <ImportExportTab /> },
    { name: 'Auto Refresh', component: () => <AutoRefreshTab /> },
    { name: 'Custom', component: () => <CustomTab /> },

    // pagination position
    // { name: "Message Search", component: () => <MessageSearchTab /> },
];


@observer
export class UserPreferencesButton extends Component {
    @observable isOpen = false;

    constructor(p: any) {
        super(p);
        makeObservable(this);
    }

    render() {

        return <>
            <UserPreferencesDialog visible={this.isOpen} onClose={() => this.isOpen = false} />
            <Button shape="circle" icon={<ToolsIcon size={17} />} className="hoverButton userPreferencesButton"
                onClick={() => this.isOpen = true}
            />
        </>;
    }
}

@observer
export class UserPreferencesDialog extends Component<{ visible: boolean, onClose: Action }> {
    @observable selectedTab: string = settingsTabs[0].name;
    constructor(p: any) {
        super(p);
        makeObservable(this);
    }
    render() {
        const { visible, onClose } = this.props;
        const tab = settingsTabs.first(t => t.name == this.selectedTab);

        return 1 &&
            <Modal centered open={visible}
                closable={false}
                title={null}
                onOk={onClose}
                onCancel={onClose}

                destroyOnClose={true}

                cancelButtonProps={{ style: { display: 'none' } }}
                maskClosable={true}
                footer={<div style={{ display: 'flex', gap: '16px', alignItems: 'center', justifyContent: 'flex-end' }}>
                    <div style={{ fontFamily: '"Open Sans", sans-serif', fontSize: '10.5px', color: '#828282' }}>
                        Changes are saved automatically
                    </div>
                    <Button type="primary" onClick={onClose} >Close</Button>
                </div>}
                className="preferencesDialog"
                bodyStyle={{ padding: '0', display: 'flex', flexDirection: 'column' }}
            >
                {/* Title */}
                <div className="h3" style={{ display: 'flex', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid hsl(0 0% 90% / 1)' }}>
                    User Preferences
                </div>

                {/* Body */}
                <div style={{ display: 'flex', flexGrow: 1 }}>
                    {/* Menu */}
                    <Menu mode="vertical" style={{ width: '160px', height: '100%' }} selectedKeys={[this.selectedTab]} onClick={p => this.selectedTab = p.key.toString()}>
                        {settingsTabs.map(t => <Menu.Item key={t.name} >{t.name}</Menu.Item>)}
                    </Menu>

                    {/* Content */}
                    <div style={{
                        display: 'flex', flexGrow: 1, gap: '16px', flexDirection: 'column',
                        padding: '0 20px', paddingBottom: '40px',
                    }}>
                        <div className="h3" style={{ marginTop: '16px', marginBottom: '8px' }}>{tab?.name}</div>
                        {tab?.component()}
                    </div>
                </div>
            </Modal>;
    }
}



@observer
class StatsBarTab extends Component {
    render() {
        return <div>
            <p>Controls on what pages Redpanda Console shows the statistics bar</p>
            <div style={{ display: 'inline-grid', gridAutoFlow: 'row', gridRowGap: '24px', gridColumnGap: '32px', marginRight: 'auto' }}>
                <Label text="Topic Details" >
                    <Checkbox children="Enabled" checked={uiSettings.topicDetailsShowStatisticsBar} onChange={e => uiSettings.topicDetailsShowStatisticsBar = e.target.checked} />
                </Label>
                <Label text="Consumer Group Details" >
                    <Checkbox children="Enabled" checked={uiSettings.consumerGroupDetails.showStatisticsBar} onChange={e => uiSettings.consumerGroupDetails.showStatisticsBar = e.target.checked} />
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
                    <Input value={settings.fontSize} onChange={e => settings.fontSize = e.target.value} style={{ maxWidth: '150px' }} />
                </Label>
                <Label text="Line Height">
                    <Input value={settings.lineHeight} onChange={e => settings.lineHeight = e.target.value} style={{ maxWidth: '150px' }} />
                </Label>
                <Label text="Maximum string length before collapsing">
                    <InputNumber value={settings.maxStringLength} onChange={e => settings.maxStringLength = (e ?? 200)} min={0} max={10000} style={{ maxWidth: '150px' }} />
                </Label>
            </div>
        </div>;
    }
}

@observer
class ImportExportTab extends Component {
    @observable importCode = '';
    @observable resetConfirm = '';

    constructor(p: any) {
        super(p);
        makeObservable(this);
    }

    render() {
        return <>
            <Label text="Import">
                <div style={{ display: 'flex' }}>
                    <Input
                        style={{ maxWidth: '360px', marginRight: '8px', fontFamily: 'monospace', fontSize: '0.85em' }} spellCheck={false}
                        placeholder="Paste a previously exported settings string..."
                        value={this.importCode}
                        onChange={e => this.importCode = e.target.value}
                        size="small"
                    />
                    <Button onClick={() => {
                        try {
                            const data = JSON.parse(this.importCode);
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
                                message.warn('Some properties were skipped during import:\n' + skipped.join(', '));
                            else
                                message.success('Settings imported successfully');
                            this.importCode = '';
                        } catch (e) {
                            message.error('Unable to import settings. See console for more information.');
                            console.error('unable to import settings', { error: e });
                        }

                    }}>Import</Button>
                </div>
            </Label>

            <Label text="Export">
                <Button onClick={() => {
                    try {
                        navigator.clipboard.writeText(JSON.stringify(uiSettings));
                        message.success('Preferences copied to clipboard!');
                    } catch (e) {
                        message.error('Unable to copy settings to clipboard. See console for more information.');
                        console.error('unable to copy settings to clipboard', { error: e });
                    }
                }}>
                    Export User Preferences
                </Button>
            </Label>

            <Label text="Reset">
                <>
                    <div>
                        <Input style={{ maxWidth: '360px', marginRight: '8px', fontFamily: 'monospace', fontSize: '0.85em' }} spellCheck={false}
                            placeholder='type "reset" here to confirm and enable the button'
                            value={this.resetConfirm}
                            onChange={str => this.resetConfirm = str.target.value} />
                        <Button onClick={() => {
                            clearSettings();
                            message.success('All settings have been reset to their defaults');
                            this.resetConfirm = '';
                        }} danger disabled={this.resetConfirm != 'reset'}>Reset</Button>
                    </div>
                    <span className="smallText">Clear all your user settings, resetting them to the default values</span>
                </>
            </Label>
        </>;
    }
}

@observer
class AutoRefreshTab extends Component {
    render() {
        return <div>
            <p>Settings for the Auto Refresh Button</p>
            <div style={{ display: 'inline-grid', gridAutoFlow: 'row', gridRowGap: '24px', gridColumnGap: '32px', marginRight: 'auto' }}>
                <Label text="Interval in seconds">
                    <InputNumber
                        value={uiSettings.autoRefreshIntervalSecs}
                        onChange={e => {
                            if (e) {
                                uiSettings.autoRefreshIntervalSecs = e;
                            }
                        }}
                        min={5} max={300}
                        style={{ maxWidth: '150px' }}
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
                <Label text="Parse Java messages to JSON">
                    <Checkbox children="Enabled" checked={uiSettings.parseJavaToJson} onChange={e => {
                        uiSettings.parseJavaToJson = e.target.checked;
                    }} />
                </Label>
                <Label text="Topic Operations">
                    <Checkbox children="Enabled" checked={uiSettings.enableTopicOperations} onChange={e => {
                        uiSettings.enableTopicOperations = e.target.checked;
                        appGlobal.onRefresh();
                    }} />
                </Label>

                {
                    !ShowBulkDeleteButtons ? <></>
                    : <>
                        <Label text="Delete All Records">
                            <DeleteDisabledTooltip>
                                <Button
                                    type="default"
                                    danger
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
                                    type="default"
                                    danger
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
                    </>
                }
            </div>
        </div>;
    }
}

function DeleteDisabledTooltip(props: { children: JSX.Element }): JSX.Element {
    const deleteButton = props.children;
    const wrap = (button: JSX.Element, message: string) => (
        <Tooltip placement="top" trigger="hover" mouseLeaveDelay={0} getPopupContainer={findPopupContainer} overlay={message}>
            {React.cloneElement(button, {
                disabled: true,
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

    const cleanup = () => {
        setDeletionPending(false);
        setError(null);
    };

    const finish = (errors: Array<string>) => {
        onFinish();
        cleanup();
        if (errors.length > 0) {
            for (const error of errors) {
                notification['error']({
                    message: `${error}`,
                })
            }
        } else {
            notification['success']({
                message: 'Records from all topics deleted successfully',
            });
        }
    };

    const cancel = () => {
        onCancel();
        cleanup();
    };

    return (
        <Modal
            className="deleteAllRecordsModal"
            visible={deleteAllRecordsVisible}
            centered
            closable={false}
            maskClosable={!deletionPending}
            keyboard={!deletionPending}
            okText={error ? 'Retry' : 'Yes'}
            confirmLoading={deletionPending}
            okType="danger"
            cancelText="No"
            cancelButtonProps={{ disabled: deletionPending }}
            onCancel={cancel}
            onOk={() => {
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
                .finally(() => { setDeletionPending(false) });
            }}
        >
            <>
                {error && <Alert type="error" message={`An error occurred: ${typeof error === 'string' ? error : error.message}`} />}
                <p>
                    Are you sure you want to delete all records from all topics? This action is irrevocable.
                </p>
            </>
        </Modal>
    );
}

function ConfirmDeleteAllTopicsModal({ deleteAllTopicsVisible, onFinish, onCancel }: { deleteAllTopicsVisible: boolean; onFinish: () => void; onCancel: () => void }) {
    const [deletionPending, setDeletionPending] = useState(false);
    const [error, setError] = useState<string | Error | null>(null);

    const cleanup = () => {
        setDeletionPending(false);
        setError(null);
    };

    const finish = (errors: Array<string>) => {
        onFinish();
        cleanup();
        if (errors.length > 0) {
            for (const error of errors) {
                notification['error']({
                    message: `${error}`,
                })
            }
        } else {
            notification['success']({
                message: 'Topics deleted successfully',
            });
        }
    };

    const cancel = () => {
        onCancel();
        cleanup();
    };

    return (
        <Modal
            className="deleteAllTopicsModal"
            visible={deleteAllTopicsVisible}
            centered
            closable={false}
            maskClosable={!deletionPending}
            keyboard={!deletionPending}
            okText={error ? 'Retry' : 'Yes'}
            confirmLoading={deletionPending}
            okType="danger"
            cancelText="No"
            cancelButtonProps={{ disabled: deletionPending }}
            onCancel={cancel}
            onOk={() => {
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
                .finally(() => { setDeletionPending(false) });
            }}
        >
            <>
                {error && <Alert type="error" message={`An error occurred: ${typeof error === 'string' ? error : error.message}`} />}
                <p>
                    Are you sure you want to delete all topics? This action is irrevocable.
                </p>
            </>
        </Modal>
    );
}
