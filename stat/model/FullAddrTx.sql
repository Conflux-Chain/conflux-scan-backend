-- https://dev.mysql.com/doc/refman/5.7/en/alter-table-partition-operations.html
CREATE TABLE if not exists `address_tx` (
  `addressId` bigint unsigned NOT NULL,
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
  primary key  (`addressId` desc,`epoch` desc, `blockPosition` desc, `txPosition` desc),
  KEY `idx_block_time` (`createdAt` DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
partition by hash (addressId)
   PARTITIONS 13;