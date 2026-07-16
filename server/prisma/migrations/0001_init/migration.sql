-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `email` VARCHAR(255) NOT NULL,
    `role` VARCHAR(32) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `team` VARCHAR(255) NOT NULL DEFAULT '',
    `permissions` JSON NULL,
    `viewCapOverride` INTEGER NULL,
    `createdAt` VARCHAR(40) NULL,
    `passwordHash` VARCHAR(255) NOT NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_role_idx`(`role`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `datasets` (
    `id` VARCHAR(64) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `source` VARCHAR(255) NOT NULL DEFAULT '',
    `type` VARCHAR(32) NOT NULL,
    `module` VARCHAR(32) NOT NULL DEFAULT 'owners',
    `fileName` VARCHAR(512) NOT NULL DEFAULT '',
    `communityLabel` VARCHAR(255) NOT NULL DEFAULT '',
    `importedAt` VARCHAR(40) NOT NULL,
    `cost` DOUBLE NULL,
    `totalUnits` INTEGER NOT NULL DEFAULT 0,
    `callableUnits` INTEGER NOT NULL DEFAULT 0,
    `updatedUnits` INTEGER NOT NULL DEFAULT 0,

    INDEX `datasets_importedAt_idx`(`importedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `properties` (
    `id` VARCHAR(64) NOT NULL,
    `orgId` VARCHAR(64) NOT NULL,
    `datasetId` VARCHAR(64) NOT NULL,
    `state` VARCHAR(32) NOT NULL,
    `unitKey` VARCHAR(512) NOT NULL,
    `community` VARCHAR(255) NOT NULL DEFAULT '',
    `cluster` VARCHAR(255) NULL,
    `building` VARCHAR(255) NULL,
    `unitNumber` VARCHAR(255) NULL,
    `plotNumber` VARCHAR(255) NULL,
    `propertyType` VARCHAR(255) NULL,
    `beds` INTEGER NULL,
    `sizeSqft` DOUBLE NULL,
    `plotSqft` DOUBLE NULL,
    `lastTransactionDate` VARCHAR(40) NULL,
    `lastTransactionValue` DOUBLE NULL,
    `txCount` INTEGER NOT NULL DEFAULT 0,
    `rentStart` VARCHAR(40) NULL,
    `rentEnd` VARCHAR(40) NULL,
    `rentAmount` DOUBLE NULL,
    `ownerName` VARCHAR(255) NOT NULL DEFAULT '',
    `ownerPhone` VARCHAR(64) NULL,
    `ownerNationality` VARCHAR(128) NULL,
    `createdAt` VARCHAR(40) NOT NULL,
    `updatedAt` VARCHAR(40) NOT NULL,
    `assignedTo` VARCHAR(64) NULL,
    `assignedAt` VARCHAR(40) NULL,
    `assignmentNote` TEXT NULL,
    `cooldownUntil` VARCHAR(40) NULL,
    `portfolioSince` VARCHAR(40) NULL,
    `lastOutcome` VARCHAR(32) NULL,
    `lastCalledAt` VARCHAR(40) NULL,
    `callAttempts` INTEGER NOT NULL DEFAULT 0,
    `nextFollowUpAt` VARCHAR(40) NULL,
    `dncAt` VARCHAR(40) NULL,

    INDEX `properties_datasetId_idx`(`datasetId`),
    INDEX `properties_state_idx`(`state`),
    INDEX `properties_assignedTo_idx`(`assignedTo`),
    INDEX `properties_community_idx`(`community`),
    INDEX `properties_unitKey_idx`(`unitKey`),
    INDEX `properties_ownerPhone_idx`(`ownerPhone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `leads` (
    `id` VARCHAR(64) NOT NULL,
    `orgId` VARCHAR(64) NOT NULL,
    `datasetId` VARCHAR(64) NOT NULL,
    `enquiryDate` VARCHAR(40) NULL,
    `name` VARCHAR(255) NOT NULL DEFAULT '',
    `phone` VARCHAR(64) NULL,
    `email` VARCHAR(255) NULL,
    `project` VARCHAR(255) NULL,
    `source` VARCHAR(255) NULL,
    `extra` JSON NULL,
    `createdAt` VARCHAR(40) NOT NULL,
    `state` VARCHAR(32) NOT NULL,
    `updatedAt` VARCHAR(40) NOT NULL,
    `assignedTo` VARCHAR(64) NULL,
    `assignedAt` VARCHAR(40) NULL,
    `assignmentNote` TEXT NULL,
    `cooldownUntil` VARCHAR(40) NULL,
    `portfolioSince` VARCHAR(40) NULL,
    `lastOutcome` VARCHAR(32) NULL,
    `lastCalledAt` VARCHAR(40) NULL,
    `callAttempts` INTEGER NOT NULL DEFAULT 0,
    `nextFollowUpAt` VARCHAR(40) NULL,
    `dncAt` VARCHAR(40) NULL,

    INDEX `leads_datasetId_idx`(`datasetId`),
    INDEX `leads_state_idx`(`state`),
    INDEX `leads_assignedTo_idx`(`assignedTo`),
    INDEX `leads_phone_idx`(`phone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `calls` (
    `id` VARCHAR(64) NOT NULL,
    `orgId` VARCHAR(64) NOT NULL,
    `propertyIds` JSON NOT NULL,
    `leadIds` JSON NOT NULL,
    `brokerId` VARCHAR(64) NOT NULL,
    `at` VARCHAR(40) NOT NULL,
    `outcome` VARCHAR(32) NOT NULL,
    `note` TEXT NULL,
    `followUpAt` VARCHAR(40) NULL,

    INDEX `calls_brokerId_idx`(`brokerId`),
    INDEX `calls_at_idx`(`at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `requests` (
    `id` VARCHAR(64) NOT NULL,
    `orgId` VARCHAR(64) NOT NULL,
    `brokerId` VARCHAR(64) NOT NULL,
    `community` VARCHAR(255) NOT NULL DEFAULT '',
    `cluster` VARCHAR(255) NULL,
    `count` INTEGER NOT NULL DEFAULT 0,
    `unitIds` JSON NOT NULL,
    `note` TEXT NULL,
    `at` VARCHAR(40) NOT NULL,
    `status` VARCHAR(32) NOT NULL DEFAULT 'pending',
    `decidedAt` VARCHAR(40) NULL,
    `grantedCount` INTEGER NOT NULL DEFAULT 0,

    INDEX `requests_status_idx`(`status`),
    INDEX `requests_at_idx`(`at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit` (
    `id` VARCHAR(64) NOT NULL,
    `orgId` VARCHAR(64) NOT NULL,
    `at` VARCHAR(40) NOT NULL,
    `actorId` VARCHAR(64) NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `detail` TEXT NOT NULL,
    `propertyIds` JSON NOT NULL,

    INDEX `audit_actorId_idx`(`actorId`),
    INDEX `audit_action_idx`(`action`),
    INDEX `audit_at_idx`(`at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `meta` (
    `id` VARCHAR(64) NOT NULL,
    `rev` BIGINT NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `settings` (
    `id` VARCHAR(64) NOT NULL,
    `notInterestedCooldownDays` INTEGER NOT NULL DEFAULT 30,
    `listedCooldownDays` INTEGER NOT NULL DEFAULT 30,
    `maxNoAnswerAttempts` INTEGER NOT NULL DEFAULT 3,
    `assignmentExpiryDays` INTEGER NOT NULL DEFAULT 14,
    `portfolioStaleDays` INTEGER NOT NULL DEFAULT 21,
    `dailyViewCap` INTEGER NOT NULL DEFAULT 100,
    `wifiLockEnabled` BOOLEAN NOT NULL DEFAULT false,
    `officeIp` VARCHAR(128) NOT NULL DEFAULT '',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

