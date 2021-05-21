CREATE TABLE `full_miner_block` (
  `minerId` bigint(20) unsigned NOT NULL,
  `epoch` bigint(20) unsigned NOT NULL,
  `position` smallint(6) NOT NULL DEFAULT '0',
  `createdAt` datetime NOT NULL,
  PRIMARY KEY (`minerId` DESC, `epoch` DESC, `position` DESC),
  KEY `block_time_idx` (`createdAt` DESC)
) ENGINE=InnoDB  DEFAULT CHARSET=utf8
partition by hash (minerId)
   PARTITIONS 13;