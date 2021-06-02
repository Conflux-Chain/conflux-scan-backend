CREATE TABLE `epoch` (
  `id` bigint(20) NOT NULL,
  `timestamp` datetime NOT NULL,
  `parentHash` bigint(20) NOT NULL,
  `pivotHash` bigint(20) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `time_idx` (`timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
partition by range (id) (
    PARTITION p1 VALUES LESS THAN (10000000/*1Kw*/),
    PARTITION p2 VALUES LESS THAN (20000000/*2Kw*/),
    PARTITION p3 VALUES LESS THAN (30000000/*3Kw*/),
    PARTITION pm VALUES LESS THAN maxvalue /*fallback partition, should add partition before reach it.*/
    );