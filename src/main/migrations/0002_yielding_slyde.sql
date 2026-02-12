ALTER TABLE `bookmarks` ADD `icon` text;--> statement-breakpoint
ALTER TABLE `bookmarks` ADD `isDefault` integer DEFAULT 0 NOT NULL;