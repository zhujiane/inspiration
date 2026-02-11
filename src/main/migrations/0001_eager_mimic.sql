CREATE TABLE `bookmarks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`name` text NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	`parent_id` integer DEFAULT 0 NOT NULL,
	`type` integer DEFAULT 0 NOT NULL,
	`url` text,
	`storage` text,
	`userDataPath` text,
	`status` integer DEFAULT 0 NOT NULL,
	`description` text
);
