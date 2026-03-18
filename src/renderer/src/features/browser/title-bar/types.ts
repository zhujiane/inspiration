import type { Bookmark } from '@shared/db/bookmark-schema'

export type TitleBarBookmark = Pick<Bookmark, 'id' | 'name' | 'type' | 'url' | 'icon' | 'userDataPath'>
