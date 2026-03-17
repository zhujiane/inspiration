CREATE TABLE `tag_maps` (
	`map_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`map_id`, `tag_id`)
);
--> statement-breakpoint
CREATE INDEX `tag_maps_map_id_idx` ON `tag_maps` (`map_id`);--> statement-breakpoint
CREATE INDEX `tag_maps_tag_id_idx` ON `tag_maps` (`tag_id`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_type_name_unique` ON `tags` (`type`,`name`);--> statement-breakpoint
CREATE INDEX `tags_type_idx` ON `tags` (`type`);