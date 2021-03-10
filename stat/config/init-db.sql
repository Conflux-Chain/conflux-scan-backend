
CREATE TABLE `address` (
                           `id`    BIGINT AUTO_INCREMENT,
                           `hex40` varchar(40),
                           `base32` varchar(128),
                           PRIMARY KEY (`id`),
                           UNIQUE KEY(`hex40`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `batch_index` (
                               `id` BIGINT AUTO_INCREMENT,
                               `type` VARCHAR(64),
                               `begin_time` DATETIME,
                               `end_time` DATETIME,
                               `state` VARCHAR(16),
                               `valueDesc` VARCHAR(16),
                               `value2desc` VARCHAR(16),
                               `value3desc` VARCHAR(16),
                               `value4desc` VARCHAR(16),
                               PRIMARY KEY (`id`),
                               UNIQUE KEY(`type`, `begin_time`, `end_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `top_record` (
                              `id` BIGINT AUTO_INCREMENT,
                              `batch_id` BIGINT,
                              `address_id` BIGINT,
                              `value` DECIMAL(36),
                              `rank` INTEGER,
                              `percent` DECIMAL(12, 10),
                              `value2` DECIMAL(36, 18),
                              `value3` DECIMAL(36, 18),
                              `value4` DECIMAL(36, 18),
                              PRIMARY KEY (`id`),
                              FOREIGN KEY (batch_id) REFERENCES batch_index(id),
                              FOREIGN KEY (address_id) REFERENCES address(id),
                              unique key (batch_id, address_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

alter table top_record add index idx_batch_id (batch_id desc , `rank` asc);

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
