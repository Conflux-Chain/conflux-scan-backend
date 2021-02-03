CREATE TABLE if not exists `address` (
                           `id`    BIGINT AUTO_INCREMENT,
                           `hex40` varchar(40),
                           `base32` varchar(128) null default '',
                           PRIMARY KEY (`id`),
                           UNIQUE KEY(`hex40`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE if not exists `batch_index` (
                               `id` BIGINT AUTO_INCREMENT,
                               `type` VARCHAR(32),
                               `begin_time` DATETIME,
                               `end_time` DATETIME,
                               `state` VARCHAR(16),
                               `value2desc` VARCHAR(16),
                               PRIMARY KEY (`id`),
                               UNIQUE KEY(`type`, `begin_time`, `end_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE if not exists `top_record`(
                              `id` BIGINT AUTO_INCREMENT,
                              `batch_id` BIGINT,
                              `address_id` BIGINT,
                              `value` DECIMAL(36),
                              `rank` INTEGER,
                              `percent` DECIMAL(12,10),
                              `value2` DECIMAL(36, 18),
                              PRIMARY KEY (`id`),
                              FOREIGN KEY (batch_id) REFERENCES batch_index(id),
                              FOREIGN KEY (address_id) REFERENCES address(id),
                              index idx_batch (batch_id desc , `rank` asc )
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
