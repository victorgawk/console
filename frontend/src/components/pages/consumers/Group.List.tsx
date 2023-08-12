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

import React from 'react';
import { Row, Statistic, Tag } from 'antd';
import { observer } from 'mobx-react';

import { api } from '../../../state/backendApi';
import { PageComponent, PageInitHelper } from '../Page';
import { GroupMemberDescription, GroupDescription } from '../../../state/restInterfaces';
import { makePaginationConfig, sortField } from '../../misc/common';
import { uiSettings } from '../../../state/ui';
import { appGlobal } from '../../../state/appGlobal';
import { GroupState } from './Group.Details';
import { autorun, IReactionDisposer } from 'mobx';
import { containsIgnoreCase } from '../../../utils/utils';
import { editQuery } from '../../../utils/queryHelper';
import { DefaultSkeleton } from '../../../utils/tsxUtils';
import { BrokerList } from '../../misc/BrokerList';
import { ShortNum } from '../../misc/ShortNum';
import { KowlTable } from '../../misc/KowlTable';
import Section from '../../misc/Section';
import PageContent from '../../misc/PageContent';
import { SearchField } from '@redpanda-data/ui';


@observer
class GroupList extends PageComponent {

    pageConfig = makePaginationConfig(uiSettings.consumerGroupList.pageSize);
    quickSearchReaction: IReactionDisposer;

    initPage(p: PageInitHelper): void {
        p.title = 'Consumer Groups';
        p.addBreadcrumb('Consumer Groups', '/groups');

        this.refreshData(false);
        appGlobal.onRefresh = () => this.refreshData(true);
    }

    componentDidMount() {
        // 1. use 'q' parameter for quick search (if it exists)
        editQuery(query => {
            if (query['q'])
                uiSettings.consumerGroupList.quickSearch = String(query['q']);
        });

        // 2. whenever the quick search box changes, update the url
        this.quickSearchReaction = autorun(() => {
            editQuery(query => {
                const q = String(uiSettings.consumerGroupList.quickSearch);
                if (q) query['q'] = q;
            });
        });
    }
    componentWillUnmount() {
        if (this.quickSearchReaction) this.quickSearchReaction();
    }

    refreshData(force: boolean) {
        api.refreshConsumerGroups(force);
    }

    render() {
        if (!api.consumerGroups) return DefaultSkeleton;

        const groups = Array.from(api.consumerGroups.values());
        const stateGroups = groups.groupInto(g => g.state);
        const tableSettings = uiSettings.consumerGroupList ?? {};

        return (
            <>
                <PageContent>
                    <Section py={4}>
                        <Row>
                            <Statistic title="Total Groups" value={groups.length} />
                            <div
                                style={{
                                    width: '1px',
                                    background: '#8883',
                                    margin: '0 1.5rem',
                                    marginLeft: 0,
                                }}
                            />
                            {stateGroups.map((g) => (
                                <Statistic
                                    style={{ marginRight: '1.5rem' }}
                                    key={g.key}
                                    title={g.key}
                                    value={g.items.length}
                                />
                            ))}
                        </Row>
                    </Section>

                    <Section>
                        {/* Searchbar */} {/* Filters */}
                        <div
                            style={{
                                marginBottom: '.5rem',
                                padding: '0',
                                whiteSpace: 'nowrap',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '2em',
                            }}
                        >
                            <this.SearchBar />
                            {/*
                        <Checkbox
                            value={uiSettings.consumerGroupList.hideEmpty}
                            onChange={c => uiSettings.consumerGroupList.hideEmpty = c.target.checked}
                        >
                            Hide Empty
                        </Checkbox>
                        */}
                        </div>
                        {/* Content */}
                        <KowlTable
                            dataSource={groups}
                            columns={[
                                {
                                    title: 'State',
                                    dataIndex: 'state',
                                    width: '130px',
                                    sorter: sortField('state'),
                                    render: (t, r) => <GroupState group={r} />,
                                    filterType: { type: 'enum' },
                                },
                                {
                                    title: 'ID',
                                    dataIndex: 'groupId',
                                    sorter: sortField('groupId'),
                                    // filteredValue: [tableSettings.quickSearch],
                                    // onFilter: (filterValue, record: GroupDescription) =>
                                    //     !filterValue ||
                                    //     containsIgnoreCase(
                                    //         record.groupId,
                                    //         String(filterValue)
                                    //     ),
                                    render: (t, r) => <this.GroupId group={r} />,
                                    className: 'whiteSpaceDefault',
                                },
                                {
                                    title: 'Coordinator',
                                    dataIndex: 'coordinatorId',
                                    width: 1,
                                    render: (x: number) => <BrokerList brokerIds={[x]} />,
                                },
                                { title: 'Protocol', dataIndex: 'protocol', width: 1 },
                                {
                                    title: 'Members',
                                    dataIndex: 'members',
                                    width: 1,
                                    render: (t: GroupMemberDescription[]) => t.length,
                                    sorter: (a, b) => a.members.length - b.members.length,
                                    defaultSortOrder: 'descend',
                                },
                                {
                                    title: 'Lag (Sum)',
                                    dataIndex: 'lagSum',
                                    render: (v) => ShortNum({ value: v }),
                                    sorter: (a, b) => a.lagSum - b.lagSum,
                                },
                            ]}
                            search={{
                                isRowMatch: (row, regex) => {
                                    if (regex.test(row.groupId)) return true;
                                    return false;
                                },
                            }}
                            observableSettings={tableSettings}
                            rowKey={(x) => x.groupId}
                            rowClassName="hoverLink"
                            onRow={(record) => ({
                                onClick: () =>
                                    appGlobal.history.push(`/groups/${encodeURIComponent(record.groupId)}`),
                            })}
                        />
                    </Section>
                </PageContent>
            </>
        );
    }

    SearchBar = observer(() => {
        return <SearchField width="350px"
            placeholderText="Enter search term/regex"
            searchText={uiSettings.consumerGroupList.quickSearch}
            setSearchText={x => uiSettings.consumerGroupList.quickSearch = x}
        />
    })

    GroupId = (p: { group: GroupDescription }) => {
        const protocol = p.group.protocolType;

        if (protocol == 'consumer') return <>{p.group.groupId}</>;

        return <>
            <Tag>Protocol: {protocol}</Tag>
            <span> {p.group.groupId}</span>
        </>;
    }
}

export default GroupList;
