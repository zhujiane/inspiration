import { useState, useRef, useEffect, useCallback } from 'react'
import { Dropdown, Tooltip } from 'antd'
import type { MenuProps } from 'antd'
import {
  LeftOutlined,
  RightOutlined,
  HomeOutlined,
  ReloadOutlined,
  StarOutlined,
  StarFilled,
  PlusOutlined,
  CloseOutlined,
  MinusOutlined,
  ExpandOutlined,
  AppstoreOutlined,
  SettingOutlined,
  UserOutlined,
  DownOutlined
} from '@ant-design/icons'

export interface Tab {
  id: string
  title: string
  url?: string
  favicon?: string
  userDataPath?: string
}

interface TitleBarProps {
  tabs: Tab[]
  activeTabId: string
  url: string
  isFavorited: boolean
  onBack?: () => void
  onForward?: () => void
  onHome?: () => void
  onReload?: () => void
  onUrlChange?: (url: string) => void
  onUrlSubmit?: (url: string) => void
  onToggleFavorite?: () => void
  onTabSelect?: (id: string) => void
  onTabClose?: (id: string) => void
  onTabAdd?: () => void
  onCloseAll?: () => void
  onCloseRight?: () => void
  onCloseOthers?: () => void
  onMenuClick?: (key: string) => void
  onMinimize?: () => void
  onMaximize?: () => void
  onClose?: () => void
  canGoBack?: boolean
  canGoForward?: boolean
}

export default function TitleBar({
  tabs,
  activeTabId,
  url,
  isFavorited,
  onBack,
  onForward,
  onHome,
  onReload,
  onUrlChange,
  onUrlSubmit,
  onToggleFavorite,
  onTabSelect,
  onTabClose,
  onTabAdd,
  onCloseAll,
  onCloseRight,
  onCloseOthers,
  onMenuClick,
  onMinimize,
  onMaximize,
  onClose,
  canGoBack = false,
  canGoForward = false
}: TitleBarProps): React.JSX.Element {
  const [searchFocused, setSearchFocused] = useState(false)
  const tabsScrollRef = useRef<HTMLDivElement>(null)
  const [showLeftArrow, setShowLeftArrow] = useState(false)
  const [showRightArrow, setShowRightArrow] = useState(false)

  const tabDropdownItems: MenuProps['items'] = [
    { key: 'closeAll', label: '关闭所有' },
    { key: 'closeRight', label: '关闭右侧' },
    { key: 'closeOthers', label: '关闭其他' }
  ]

  const handleTabDropdown: MenuProps['onClick'] = ({ key }) => {
    if (key === 'closeAll') onCloseAll?.()
    else if (key === 'closeRight') onCloseRight?.()
    else if (key === 'closeOthers') onCloseOthers?.()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      onUrlSubmit?.(e.currentTarget.value)
    }
  }

  // Check if tab scroll arrows should be visible
  const checkScrollArrows = useCallback(() => {
    const el = tabsScrollRef.current
    if (!el) return
    setShowLeftArrow(el.scrollLeft > 0)
    setShowRightArrow(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])

  useEffect(() => {
    checkScrollArrows()
    const el = tabsScrollRef.current
    if (!el) return
    el.addEventListener('scroll', checkScrollArrows)
    const ro = new ResizeObserver(checkScrollArrows)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', checkScrollArrows)
      ro.disconnect()
    }
  }, [checkScrollArrows, tabs])

  // Mouse wheel → horizontal scroll on tabs
  const handleTabsWheel = (e: React.WheelEvent): void => {
    const el = tabsScrollRef.current
    if (!el) return
    e.preventDefault()
    el.scrollLeft += e.deltaY || e.deltaX
  }

  const scrollTabsLeft = (): void => {
    const el = tabsScrollRef.current
    if (el) el.scrollBy({ left: -120, behavior: 'smooth' })
  }

  const scrollTabsRight = (): void => {
    const el = tabsScrollRef.current
    if (el) el.scrollBy({ left: 120, behavior: 'smooth' })
  }

  return (
    <header className="title-bar" id="title-bar">
      {/* 1.2 Navigation — aligned with webview */}
      <nav className="title-bar__nav" aria-label="浏览器导航">
        <Tooltip title="后退" mouseEnterDelay={0.5}>
          <button className={`title-bar__nav-btn ${!canGoBack ? 'title-bar__nav-btn--disabled' : ''}`} onClick={onBack} aria-label="后退">
            <LeftOutlined />
          </button>
        </Tooltip>
        <Tooltip title="前进" mouseEnterDelay={0.5}>
          <button className={`title-bar__nav-btn ${!canGoForward ? 'title-bar__nav-btn--disabled' : ''}`} onClick={onForward} aria-label="前进">
            <RightOutlined />
          </button>
        </Tooltip>
        <Tooltip title="首页" mouseEnterDelay={0.5}>
          <button className="title-bar__nav-btn" onClick={onHome} aria-label="首页">
            <HomeOutlined />
          </button>
        </Tooltip>
        <Tooltip title="刷新" mouseEnterDelay={0.5}>
          <button className="title-bar__nav-btn" onClick={onReload} aria-label="刷新">
            <ReloadOutlined />
          </button>
        </Tooltip>
      </nav>

      <div className="title-bar__divider" />

      {/* 1.3 URL / Search — favorite button INSIDE the input */}
      <div className="title-bar__search">
        <div className="title-bar__search-inner">
          <input
            className="title-bar__search-input"
            type="text"
            placeholder="输入网址或搜索..."
            value={url}
            onChange={(e) => onUrlChange?.(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            aria-label="地址栏"
            id="url-bar"
            style={searchFocused ? { flex: 1 } : undefined}
          />
          <Tooltip title={isFavorited ? '取消收藏' : '收藏'} mouseEnterDelay={0.5}>
            <button className={`title-bar__fav-btn ${isFavorited ? 'title-bar__fav-btn--active' : ''}`} onClick={onToggleFavorite} aria-label="收藏">
              {isFavorited ? <StarFilled /> : <StarOutlined />}
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="title-bar__divider" />

      {/* 1.4 Tabs — hidden scrollbar with arrow buttons */}
      <div className="title-bar__tabs">
        {showLeftArrow && (
          <button className="title-bar__tabs-arrow title-bar__tabs-arrow--left" onClick={scrollTabsLeft} aria-label="向左滚动标签">
            <LeftOutlined />
          </button>
        )}
        <div className="title-bar__tabs-scroll" ref={tabsScrollRef} onWheel={handleTabsWheel}>
          {tabs.map((tab) => (
            <div key={tab.id} className={`title-bar__tab ${tab.id === activeTabId ? 'title-bar__tab--active' : ''}`} onClick={() => onTabSelect?.(tab.id)} title={tab.title}>
              {tab.favicon && <img src={tab.favicon} alt="" style={{ width: 12, height: 12, borderRadius: 2 }} />}
              <span className="title-bar__tab-title">{tab.title}</span>
              <button
                className="title-bar__tab-close"
                onClick={(e) => {
                  e.stopPropagation()
                  onTabClose?.(tab.id)
                }}
                aria-label={`关闭 ${tab.title}`}
              >
                <CloseOutlined />
              </button>
            </div>
          ))}
        </div>
        {showRightArrow && (
          <button className="title-bar__tabs-arrow title-bar__tabs-arrow--right" onClick={scrollTabsRight} aria-label="向右滚动标签">
            <RightOutlined />
          </button>
        )}
        <Tooltip title="新标签页" mouseEnterDelay={0.5}>
          <button className="title-bar__tab-add" onClick={onTabAdd} aria-label="新建标签页">
            <PlusOutlined />
          </button>
        </Tooltip>
        <Dropdown menu={{ items: tabDropdownItems, onClick: handleTabDropdown }} trigger={['click']}>
          <button className="title-bar__tab-add" aria-label="标签操作">
            <DownOutlined style={{ fontSize: 10 }} />
          </button>
        </Dropdown>
      </div>

      <div className="title-bar__divider" />

      {/* 1.5 Function Menus */}
      <div className="title-bar__menus">
        <button className="title-bar__menu-btn" onClick={() => onMenuClick?.('material')} id="menu-material">
          <AppstoreOutlined style={{ fontSize: 12 }} />
          <span>素材</span>
        </button>
        <button className="title-bar__menu-btn" onClick={() => onMenuClick?.('system')} id="menu-system">
          <SettingOutlined style={{ fontSize: 12 }} />
          <span>系统</span>
        </button>
        <button className="title-bar__menu-btn" onClick={() => onMenuClick?.('user')} id="menu-user">
          <UserOutlined style={{ fontSize: 12 }} />
          <span>用户</span>
        </button>
      </div>

      {/* 1.6 Window Controls */}
      <div className="title-bar__window-controls">
        <button className="title-bar__win-btn" onClick={onMinimize} aria-label="最小化" id="win-minimize">
          <MinusOutlined />
        </button>
        <button className="title-bar__win-btn" onClick={onMaximize} aria-label="最大化" id="win-maximize">
          <ExpandOutlined />
        </button>
        <button className="title-bar__win-btn title-bar__win-btn--close" onClick={onClose} aria-label="关闭" id="win-close">
          <CloseOutlined />
        </button>
      </div>
    </header>
  )
}
