-- Apply before deploying the updated API and CfxTransferSync.
ALTER TABLE e_space_hex40 ADD COLUMN coreHex CHAR(40) NULL;
