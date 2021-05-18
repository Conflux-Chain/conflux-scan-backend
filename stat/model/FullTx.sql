CREATE TABLE `full_tx` (
  `epoch` bigint unsigned NOT NULL,
  `blockPosition` smallint NOT NULL DEFAULT '0',
  `txPosition` smallint NOT NULL DEFAULT '0',
  `createdAt` datetime NOT NULL,
  `hash` char(66) DEFAULT '',
  `fromId` bigint unsigned NOT NULL,
  `nonce` bigint unsigned NOT NULL,
  `toId` bigint unsigned NOT NULL,
  `dripValue` decimal(36,0) NOT NULL DEFAULT '0',
  `gasPrice` decimal(36,0) NOT NULL DEFAULT '0',
  `gas` decimal(36,0) NOT NULL DEFAULT '0',
  `status` tinyint NOT NULL DEFAULT '0',
  `contractCreatedId` bigint unsigned NOT NULL,
  `method` char (10) null ,
  primary key  (`epoch` desc, `blockPosition` desc, `txPosition` desc),
  KEY `idx_block_time` (`createdAt` DESC),
  KEY `idx_hash` (`hash`(10))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
partition by range (epoch)(
    PARTITION p1 VALUES LESS THAN (10000000/*1Kw*/),
    PARTITION p2 VALUES LESS THAN (20000000/*2Kw*/),
    PARTITION p3 VALUES LESS THAN (30000000/*3Kw*/),
        PARTITION p4 VALUES LESS THAN (40000000/*3Kw*/),
    PARTITION p5 VALUES LESS THAN (50000000/*3Kw*/)
);