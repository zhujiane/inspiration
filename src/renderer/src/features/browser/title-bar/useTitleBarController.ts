import { startTransition, useCallback, useMemo, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { Form, message } from 'antd'
import type { FormInstance } from 'antd'
import type { TitleBarProps } from '../../../components/TitleBar'
import type { LeftSidebarRef } from '../../../components/LeftSidebar'
import type { MainContentRef } from '../../../components/MainContent'
import { trpc } from '../../../lib/trpc'
import type { Tab } from '../types'
import { formatUrlInput, getCanonicalUrl, isWebviewTab } from '../utils'
import type { BookmarkFormValues } from './BookmarkModal'
import type { TitleBarBookmark } from './types'

interface UseTitleBarControllerParams {
  tabs: Tab[]
  activeTab?: Tab
  activeTabId: string
  url: string
  canGoBack: boolean
  canGoForward: boolean
  allBookmarks: TitleBarBookmark[]
  bookmarkGroups: TitleBarBookmark[]
  setTabs: Dispatch<SetStateAction<Tab[]>>
  setActiveTabId: Dispatch<SetStateAction<string>>
  setUrl: Dispatch<SetStateAction<string>>
  fetchBookmarkGroups: () => Promise<void>
  mainContentRef: RefObject<MainContentRef | null>
  sidebarRef: RefObject<LeftSidebarRef | null>
}

interface UseTitleBarControllerResult {
  titleBarProps: TitleBarProps
  bookmarkModalProps: {
    open: boolean
    form: FormInstance<BookmarkFormValues>
    bookmarkGroups: TitleBarBookmark[]
    onSubmit: () => void
    onCancel: () => void
  }
}

export function useTitleBarController({
  tabs,
  activeTab,
  activeTabId,
  url,
  canGoBack,
  canGoForward,
  allBookmarks,
  bookmarkGroups,
  setTabs,
  setActiveTabId,
  setUrl,
  fetchBookmarkGroups,
  mainContentRef,
  sidebarRef
}: UseTitleBarControllerParams): UseTitleBarControllerResult {
  const [bookmarkForm] = Form.useForm<BookmarkFormValues>()
  const [isBookmarkModalVisible, setIsBookmarkModalVisible] = useState(false)

  const currentBookmark = useMemo(() => {
    if (!url || !url.includes('.')) return null
    const canonicalUrl = getCanonicalUrl(url)
    return allBookmarks.find((item) => item.type === 2 && item.url && getCanonicalUrl(item.url) === canonicalUrl) ?? null
  }, [allBookmarks, url])

  const isFavorited = !!currentBookmark

  const handleTabSelect = useCallback(
    (id: string) => {
      setActiveTabId(id)
      const tab = tabs.find((item) => item.id === id)
      setUrl(tab?.url || '')
    },
    [setActiveTabId, setUrl, tabs]
  )

  const handleTabClose = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const nextTabs = prev.filter((tab) => tab.id !== id)
        if (nextTabs.length === 0) {
          setActiveTabId('')
          setUrl('')
          return nextTabs
        }

        if (id === activeTabId) {
          setActiveTabId(nextTabs[0].id)
          setUrl(nextTabs[0].url || '')
        }

        return nextTabs
      })
    },
    [activeTabId, setActiveTabId, setTabs, setUrl]
  )

  const handleCloseAllTabs = useCallback(() => {
    setTabs([])
    setActiveTabId('')
    setUrl('')
  }, [setActiveTabId, setTabs, setUrl])

  const handleCloseOtherTabs = useCallback(() => {
    const currentTab = tabs.find((tab) => tab.id === activeTabId)
    if (!currentTab) {
      handleCloseAllTabs()
      return
    }

    if (tabs.length <= 1) {
      setUrl(currentTab.url || '')
      return
    }

    setUrl(currentTab.url || '')
    startTransition(() => {
      setTabs([currentTab])
    })
  }, [activeTabId, handleCloseAllTabs, setTabs, setUrl, tabs])

  const handleToggleFavorite = useCallback(async () => {
    if (isFavorited && currentBookmark) {
      try {
        await trpc.bookmark.delete.mutate({ id: currentBookmark.id })
        message.success('已取消收藏')
        await fetchBookmarkGroups()
        sidebarRef.current?.refresh()
      } catch (error) {
        console.error('Failed to remove bookmark:', error)
        message.error('取消收藏失败')
      }
      return
    }

    bookmarkForm.setFieldsValue({
      name: activeTab?.title || '',
      url,
      parentId: bookmarkGroups[0]?.id || 0,
      userDataPath: activeTab?.userDataPath || 'default'
    })
    setIsBookmarkModalVisible(true)
  }, [activeTab, bookmarkForm, bookmarkGroups, currentBookmark, fetchBookmarkGroups, isFavorited, sidebarRef, url])

  const handleBookmarkSubmit = useCallback(async () => {
    try {
      const values = await bookmarkForm.validateFields()
      await trpc.bookmark.create.mutate({ ...values, type: 2 })
      message.success('已添加到收藏夹')
      setIsBookmarkModalVisible(false)
      await fetchBookmarkGroups()
      sidebarRef.current?.refresh()
    } catch (error) {
      console.error('Failed to create bookmark:', error)
    }
  }, [bookmarkForm, fetchBookmarkGroups, sidebarRef])

  const handleUrlSubmit = useCallback(
    (input: string) => {
      const formattedUrl = formatUrlInput(input.trim())
      if (!formattedUrl) return

      setUrl(formattedUrl)

      if (!activeTab || !isWebviewTab(activeTab)) {
        const nextTab: Tab = {
          id: `tab-${Date.now()}`,
          title: '新标签页',
          url: formattedUrl,
          userDataPath: 'default',
          type: 'webview'
        }
        setTabs((prev) => [...prev, nextTab])
        setActiveTabId(nextTab.id)
        return
      }

      mainContentRef.current?.loadURL(formattedUrl)
    },
    [activeTab, mainContentRef, setActiveTabId, setTabs, setUrl]
  )

  const titleBarProps = useMemo<TitleBarProps>(
    () => ({
      tabs,
      activeTabId,
      url,
      isFavorited,
      canGoBack,
      canGoForward,
      onBack: () => mainContentRef.current?.goBack(),
      onForward: () => mainContentRef.current?.goForward(),
      onReload: () => mainContentRef.current?.reload(),
      onUrlChange: setUrl,
      onUrlSubmit: handleUrlSubmit,
      onToggleFavorite: () => void handleToggleFavorite(),
      onTabSelect: handleTabSelect,
      onTabClose: handleTabClose,
      onCloseAll: handleCloseAllTabs,
      onCloseOthers: handleCloseOtherTabs,
      onMinimize: () => {
        void trpc.system.minimize.mutate()
      },
      onMaximize: () => {
        void trpc.system.maximize.mutate()
      },
      onClose: () => {
        void trpc.system.close.mutate()
      }
    }),
    [
      activeTabId,
      canGoBack,
      canGoForward,
      handleCloseAllTabs,
      handleCloseOtherTabs,
      handleTabClose,
      handleTabSelect,
      handleToggleFavorite,
      handleUrlSubmit,
      isFavorited,
      mainContentRef,
      setUrl,
      tabs,
      url
    ]
  )

  return {
    titleBarProps,
    bookmarkModalProps: {
      open: isBookmarkModalVisible,
      form: bookmarkForm,
      bookmarkGroups,
      onSubmit: () => void handleBookmarkSubmit(),
      onCancel: () => setIsBookmarkModalVisible(false)
    }
  }
}
