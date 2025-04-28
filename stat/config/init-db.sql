
CREATE TABLE `address` (
                           `id`    BIGINT AUTO_INCREMENT,
                           `hex40` varchar(40),
                           `base32` varchar(128),
                           PRIMARY KEY (`id`),
                           UNIQUE KEY(`hex40`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;



create table address_info
(
    id       bigint                 not null
        primary key,
    name     char(32)               not null,
    createAt datetime               not null,
    updateAt datetime               not null,
    remark   char(128) default ''   not null,
    state    char(16)  default 'ok' not null,
    constraint name
        unique (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

create table block
(
    id          int auto_increment
        primary key,
    difficulty  bigint      default 0  not null,
    epoch       bigint                 not null,
    createAt    datetime               not null,
    minerId     bigint                 not null,
    hashId      bigint      default 0  null,
    hash        char(66)    default '' null,
    totalReward decimal(36) default 0  not null,
    txFee       decimal(36) default 0  not null
);

create index block_hash
    on block (hash);

create index block_time_idx
    on block (createAt desc);

create index miner_idx
    on block (minerId);


create table config
(
    `key` char(30) not null
        primary key,
    value char(128) null
);

create table epoch
(
    id bigint not null
        primary key,
    timestamp datetime not null,
    parentHash bigint not null,
    pivotHash bigint not null
);

create index time_idx
    on epoch (timestamp);

create table hex40
(
    id  bigint auto_increment
        primary key,
    hex char(40) not null
);

create index hex40_index
    on hex40 (hex);

create table hex64
(
    id  bigint auto_increment
        primary key,
    hex char(64) not null,
    constraint hex64_index
        unique (hex)
);

create table minerBlock
(
    id            bigint auto_increment
        primary key,
    minerId       bigint                null,
    blockCount    bigint                null,
    difficultySum bigint                null,
    beginTime     datetime              null,
    endTime       datetime              null,
    timeWindow    char(8)               null,
    totalReward   decimal(36) default 0 not null,
    txFee         decimal(36) default 0 not null
);

create index mine_dt_idx
    on minerBlock (beginTime);


create table tx
(
    id          bigint auto_increment
        primary key,
    epochHeight bigint      not null,
    hash        char(66)    not null,
    nonce       bigint      not null,
    `from`      bigint      not null,
    `to`        bigint      not null,
    value       decimal(36) not null,
    gasPrice       bigint not null,
    gas         int         not null,
    status         int         not null,
    txIndex     int         not null,
    blockTime   datetime    not null
);

create index blockTime
    on tx (blockTime);

create index from_idx
    on tx (`from`);

create index to_idx
    on tx (`to`);

create table wcfx_balance
(
    addressId bigint auto_increment
        primary key,
    balance   decimal(36, 18) default 0.000000000000000000 not null,
    createdAt datetime                                     not null,
    updatedAt datetime                                     not null
);

create table dex_cfx_balance
(
    addressId bigint auto_increment
        primary key,
    balance   decimal(36, 18) default 0.000000000000000000 not null,
    createdAt datetime                                     not null,
    updatedAt datetime                                     not null
);

create table usdt_balance
(
    addressId bigint auto_increment
        primary key,
    balance   decimal(36, 18) default 0.000000000000000000 not null,
    createdAt datetime                                     not null,
    updatedAt datetime                                     not null
);

create table dex_usdt_balance
(
    addressId bigint auto_increment
        primary key,
    balance   decimal(36, 18) default 0.000000000000000000 not null,
    createdAt datetime                                     not null,
    updatedAt datetime                                     not null
);

create table cfx_balance
(
    addressId      bigint auto_increment
        primary key,
    balance        decimal(36, 18) default 0.000000000000000000 not null,
    stakingBalance decimal(36, 18) default 0.000000000000000000 not null,
    total          decimal(36, 18) default 0.000000000000000000 not null,
    createdAt      datetime                                     not null,
    updatedAt      datetime                                     not null
);

create table trace
(
    id bigint auto_increment
        primary key,
    txId bigint not null,
    epochHeight bigint not null,
    `from` bigint not null,
    `to` bigint not null,
    value decimal(36) not null,
    blockTime datetime not null
);

create index blockTime
    on trace (blockTime desc);

create index from_idx
    on trace (`from`);

create index to_idx
    on trace (`to`);



create table balance_CRCL_BTC_symbol
(
    addressId bigint auto_increment
        primary key,
    balance   decimal(36, 18) default 0.000000000000000000 not null,
    createdAt datetime                                     not null,
    updatedAt datetime                                     not null
);
create table balance_cMOON
(
    addressId bigint auto_increment
        primary key,
    balance   decimal(36, 18) default 0.000000000000000000 not null,
    createdAt datetime                                     not null,
    updatedAt datetime                                     not null
);

create table balance_cETH
(
    addressId bigint auto_increment
        primary key,
    balance   decimal(36, 18) default 0.000000000000000000 not null,
    createdAt datetime                                     not null,
    updatedAt datetime                                     not null
);
create table balance_FC
(
    addressId bigint auto_increment
        primary key,
    balance   decimal(36, 18) default 0.000000000000000000 not null,
    createdAt datetime                                     not null,
    updatedAt datetime                                     not null
);

create table balance_cDAI
(
    addressId bigint auto_increment
        primary key,
    balance   decimal(36, 18) default 0.000000000000000000 not null,
    createdAt datetime                                     not null,
    updatedAt datetime                                     not null
);
create table balance_cUSDC
(
    addressId bigint auto_increment
        primary key,
    balance   decimal(36, 18) default 0.000000000000000000 not null,
    createdAt datetime                                     not null,
    updatedAt datetime                                     not null
);
create table balance_cLEND
(
    addressId bigint auto_increment
        primary key,
    balance   decimal(36, 18) default 0.000000000000000000 not null,
    createdAt datetime                                     not null,
    updatedAt datetime                                     not null
);
create table balance_cFOR
(
    addressId bigint auto_increment
        primary key,
    balance   decimal(36, 18) default 0.000000000000000000 not null,
    createdAt datetime                                     not null,
    updatedAt datetime                                     not null
);
create table balance_cLINK
(
    addressId bigint auto_increment
        primary key,
    balance   decimal(36, 18) default 0.000000000000000000 not null,
    createdAt datetime                                     not null,
    updatedAt datetime                                     not null
);
create table balance_cCOMP
(
    addressId bigint auto_increment
        primary key,
    balance   decimal(36, 18) default 0.000000000000000000 not null,
    createdAt datetime                                     not null,
    updatedAt datetime                                     not null
);
create table balance_cBAND
(
    addressId bigint auto_increment
        primary key,
    balance   decimal(36, 18) default 0.000000000000000000 not null,
    createdAt datetime                                     not null,
    updatedAt datetime                                     not null
);
create table balance_cBTC
(
    addressId bigint auto_increment
        primary key,
    balance   decimal(36, 18) default 0.000000000000000000 not null,
    createdAt datetime                                     not null,
    updatedAt datetime                                     not null
);
create table balance_cYFI
(
    addressId bigint auto_increment
        primary key,
    balance   decimal(36, 18) default 0.000000000000000000 not null,
    createdAt datetime                                     not null,
    updatedAt datetime                                     not null
);
create table balance_cDF
(
    addressId bigint auto_increment
        primary key,
    balance   decimal(36, 18) default 0.000000000000000000 not null,
    createdAt datetime                                     not null,
    updatedAt datetime                                     not null
);
create table balance_cYFII
(
    addressId bigint auto_increment
        primary key,
    balance   decimal(36, 18) default 0.000000000000000000 not null,
    createdAt datetime                                     not null,
    updatedAt datetime                                     not null
);
create table balance_cSWRV
(
    addressId bigint auto_increment
        primary key,
    balance   decimal(36, 18) default 0.000000000000000000 not null,
    createdAt datetime                                     not null,
    updatedAt datetime                                     not null
);
create table balance_cKP3R
(
    addressId bigint auto_increment
        primary key,
    balance   decimal(36, 18) default 0.000000000000000000 not null,
    createdAt datetime                                     not null,
    updatedAt datetime                                     not null
);
create table balance_cUMA
(
    addressId bigint auto_increment
        primary key,
    balance   decimal(36, 18) default 0.000000000000000000 not null,
    createdAt datetime                                     not null,
    updatedAt datetime                                     not null
);
create table balance_cKNC
(
    addressId bigint auto_increment
        primary key,
    balance   decimal(36, 18) default 0.000000000000000000 not null,
    createdAt datetime                                     not null,
    updatedAt datetime                                     not null
);
create table balance_cSNX
(
    addressId bigint auto_increment
        primary key,
    balance   decimal(36, 18) default 0.000000000000000000 not null,
    createdAt datetime                                     not null,
    updatedAt datetime                                     not null
);
create table balance_csUSD
(
    addressId bigint auto_increment
        primary key,
    balance   decimal(36, 18) default 0.000000000000000000 not null,
    createdAt datetime                                     not null,
    updatedAt datetime                                     not null
);

create table token
(
    id bigint auto_increment
        primary key,
    name char(128) default '' not null,
    symbol char(64) not null,
    holder bigint not null,
    base32 char(64) not null,
    hex40id bigint not null,
    createdAt datetime not null,
    updatedAt datetime not null,
    constraint base32
        unique (base32)
);

