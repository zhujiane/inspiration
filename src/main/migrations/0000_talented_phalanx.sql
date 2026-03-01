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
	`description` text,
	`icon` text,
	`isDefault` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `configs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`value_type` text DEFAULT 'string' NOT NULL,
	`group` text DEFAULT 'general' NOT NULL,
	`label` text,
	`description` text,
	`default_value` text,
	`order` integer DEFAULT 0 NOT NULL,
	`is_system` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `resources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`url` text,
	`description` text,
	`local_path` text,
	`platform` text,
	`cover` text,
	`metadata` text
);
