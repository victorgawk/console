import React, { Component, ReactNode, useState } from 'react';
import { observer } from "mobx-react";
import { Menu, Select, Avatar, Popconfirm, Dropdown, Button, Modal, Input, message, Checkbox, InputNumber, Alert, notification, Tooltip } from 'antd';
import { uiSettings } from '../../state/ui';
import { RenderTrap, Spacer } from './common';
import { api } from '../../state/backendApi';
import Icon, { UserOutlined } from '@ant-design/icons';
import { IsBusiness, IsProduction } from '../../utils/env';
import { findPopupContainer, Label } from '../../utils/tsxUtils';
import { makeObservable, observable } from 'mobx';
import { ToolsIcon } from '@primer/octicons-react';
import { Topic } from '../../state/restInterfaces';
import { appGlobal } from '../../state/appGlobal';

const { Option } = Select;
type Action = () => void;

const settingsTabs: { name: string, component: () => ReactNode }[] = [
    { name: "Statistics Bar", component: () => <StatsBarTab /> },
    { name: "Json Viewer", component: () => <JsonViewerTab /> },
    { name: "Admin Operations", component: () => <AdminOperationsTab /> },

    // pagination position
    // { name: "Message Search", component: () => <MessageSearchTab /> },
    // { name: "Import/Export", component: () => <ImportExportTab /> },
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
            <Button shape='circle' icon={<ToolsIcon size={17} />} className='hoverButton userPreferencesButton'
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
            <Modal centered visible={visible}
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
                    <Button type='primary' onClick={onClose} >Close</Button>
                </div>}
                className='preferencesDialog'
                bodyStyle={{ padding: '0', display: 'flex', flexDirection: 'column' }}
            >
                {/* Title */}
                <div className='h3' style={{ display: 'flex', alignItems: 'center', padding: '16px 20px', borderBottom: '1px solid hsl(0 0% 90% / 1)' }}>
                    User Preferences
                </div>

                {/* Body */}
                <div style={{ display: 'flex', flexGrow: 1 }}>
                    {/* Menu */}
                    <Menu mode='vertical' style={{ width: '160px', height: '100%' }} selectedKeys={[this.selectedTab]} onClick={p => this.selectedTab = p.key.toString()}>
                        {settingsTabs.map(t => <Menu.Item key={t.name} >{t.name}</Menu.Item>)}
                    </Menu>

                    {/* Content */}
                    <div style={{
                        display: 'flex', flexGrow: 1, gap: '16px', flexDirection: 'column',
                        padding: '0 20px', paddingBottom: '40px',
                    }}>
                        <div className='h3' style={{ marginTop: '16px', marginBottom: '8px' }}>{tab?.name}</div>
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
            <p>Controls on what pages kowl shows the statistics bar</p>
            <div style={{ display: 'inline-grid', gridAutoFlow: 'row', gridRowGap: '24px', gridColumnGap: '32px', marginRight: 'auto' }}>
                <Label text='Topic Details' >
                    <Checkbox children='Enabled' checked={uiSettings.topicDetailsShowStatisticsBar} onChange={e => uiSettings.topicDetailsShowStatisticsBar = e.target.checked} />
                </Label>
                <Label text='Consumer Group Details' >
                    <Checkbox children='Enabled' checked={uiSettings.consumerGroupDetails.showStatisticsBar} onChange={e => uiSettings.consumerGroupDetails.showStatisticsBar = e.target.checked} />
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
                <Label text='Font Size'>
                    <Input value={settings.fontSize} onChange={e => settings.fontSize = e.target.value} style={{ maxWidth: '150px' }} />
                </Label>
                <Label text='Line Height'>
                    <Input value={settings.lineHeight} onChange={e => settings.lineHeight = e.target.value} style={{ maxWidth: '150px' }} />
                </Label>
                <Label text='Maximum string length before collapsing'>
                    <InputNumber value={settings.maxStringLength} onChange={e => settings.maxStringLength = e} min={0} max={10000} style={{ maxWidth: '150px' }} />
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
            <Label text='Import'>
                <Input
                    style={{ padding: '2px 8px' }}
                    placeholder='paste exported preferences string here'
                    value={this.importCode}
                    onChange={e => {
                        // todo
                    }}
                    onPaste={p => console.log('onPaste event', p)}
                    onPasteCapture={p => console.log('onPasteCapture event', p)}
                    size='small' />
            </Label>

            <Label text='Export'>
                <Button onClick={() => { message.success('Preferences copied to clipboard!'); }}>
                    Export User Preferences
                </Button>
            </Label>

            <Label text='Reset'>
                <div>
                    <div>
                        <Input style={{ maxWidth: '360px', marginRight: '8px' }}
                            placeholder='type "reset" here to confirm and enable the button'
                            value={this.resetConfirm}
                            onChange={str => this.resetConfirm = str.target.value} />
                        <Button onClick={() => { message.success('Preferences copied to clipboard!'); }} danger disabled={this.resetConfirm != 'reset'}>Reset</Button>
                    </div>
                    <span className='smallText'>Clear all your user settings, resetting them to the default values</span>
                </div>
            </Label>
        </>;
    }
}

@observer
class AdminOperationsTab extends Component {
    render() {
        return <div>
            <p>Settings for administration</p>
            <div style={{ display: 'inline-grid', gridAutoFlow: 'row', gridRowGap: '24px', gridColumnGap: '32px', marginRight: 'auto' }}>
                <Label text='Read Only Mode'>
                    <Checkbox children='Enabled' checked={uiSettings.adminOperations.readOnlyMode} onChange={e => {
                        uiSettings.adminOperations.readOnlyMode = e.target.checked;
                        appGlobal.onRefresh();
                    }} />
                </Label>

                <Label text='Auto Refresh Interval (Seconds)'>
                    <InputNumber
                        value={uiSettings.adminOperations.autoRefreshIntervalSecs}
                        onChange={e => {
                            uiSettings.adminOperations.autoRefreshIntervalSecs = e;
                            appGlobal.onRefresh();
                        }}
                        min={1} max={60}
                        style={{ maxWidth: '150px' }}
                    />
                </Label>

                {
                    IsProduction ?
                    <>
                        <Label text='Delete All Records'>
                            <DeleteDisabledTooltip>
                                <Button
                                    type="default"
                                    danger
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        uiSettings.adminOperations.deleteAllRecordsModalVisible = true;
                                    }}
                                >
                                    Delete All Records
                                </Button>
                            </DeleteDisabledTooltip>
                        </Label>
                        <ConfirmDeleteAllRecordsModal
                            deleteAllRecordsVisible={uiSettings.adminOperations.deleteAllRecordsModalVisible}
                            onCancel={() => (uiSettings.adminOperations.deleteAllRecordsModalVisible = false)}
                            onFinish={() => {
                                uiSettings.adminOperations.deleteAllRecordsModalVisible = false;
                                appGlobal.onRefresh();
                            }}
                        />

                        <Label text='Delete All Topics'>
                            <DeleteDisabledTooltip>
                                <Button
                                    type="default"
                                    danger
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        uiSettings.adminOperations.deleteAllTopicsModalVisible = true;
                                    }}
                                >
                                    Delete All Topics
                                </Button>
                            </DeleteDisabledTooltip>
                        </Label>
                        <ConfirmDeleteAllTopicsModal
                            deleteAllTopicsVisible={uiSettings.adminOperations.deleteAllTopicsModalVisible}
                            onCancel={() => (uiSettings.adminOperations.deleteAllTopicsModalVisible = false)}
                            onFinish={() => {
                                uiSettings.adminOperations.deleteAllTopicsModalVisible = false;
                                appGlobal.onRefresh();
                            }}
                        />
                    </>
                    :
                    <>
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
    return <>{uiSettings.adminOperations.readOnlyMode ? wrap(deleteButton, "Read Only Mode") : deleteButton}</>;
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
                message: `Records from all topics deleted successfully`,
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
                message: `Topics deleted successfully`,
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
