CREATE TABLE `full_block` (
                              `epoch` bigint unsigned NOT NULL,
                              `position` smallint NOT NULL DEFAULT '0',
                              `createdAt` datetime NOT NULL,
                              `txCount` int NOT NULL DEFAULT '0',
                              `executedTxnCount` int NOT NULL DEFAULT '0',
                              `pivot` tinyint(1) NOT NULL DEFAULT '0',
                              `difficulty` bigint unsigned NOT NULL DEFAULT '0',
                              `minerId` bigint unsigned NOT NULL,
                              `hash` char(66) DEFAULT '',
                              `totalReward` decimal(36,0) NOT NULL DEFAULT '0',
                              `txFee` decimal(36,0) NOT NULL DEFAULT '0',
                              `avgGasPrice` decimal(36,0) NOT NULL DEFAULT '0',
                              `gasLimit` decimal(36,0) NOT NULL DEFAULT '0',
                              `gasUsed` decimal(36,0) NOT NULL DEFAULT '0',
                              primary key  (`epoch` desc, `position` desc),
                              KEY `idx_block_time` (`createdAt` DESC),
                              KEY `block_hash` (`hash`(10))
) ENGINE=InnoDB AUTO_INCREMENT=0 DEFAULT CHARSET=utf8mb4
partition by range (epoch) (
    PARTITION p1 VALUES LESS THAN (10000000/*1Kw*/),
    PARTITION p2 VALUES LESS THAN (20000000/*2Kw*/),
    PARTITION p3 VALUES LESS THAN (30000000/*3Kw*/),
    PARTITION p4 VALUES LESS THAN (40000000/*3Kw*/),
    PARTITION p5 VALUES LESS THAN (50000000/*3Kw*/)
    );