import { useState, useRef, useEffect, useCallback } from 'react'
import { Tooltip } from 'antd'
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  SettingOutlined,
  ReloadOutlined,
  EyeOutlined
} from '@ant-design/icons'
import iconSvg from '../../assets/icon.svg'

interface FloatingCompassProps {
  active: boolean
  onStart: () => void
  onStop: () => void
  onRefresh: () => void
  onConfig: () => void
}

export default function FloatingCompass({
  active,
  onStart,
  onStop,
  onRefresh,
  onConfig
}: FloatingCompassProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [hidden, setHidden] = useState(false)

  // Position is stored in a ref for direct DOM manipulation during drag.
  // React state is only used for the hidden/restore button which needs a re-render.
  const posRef = useRef({ x: 20, y: 200 })
  const containerRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLButtonElement>(null)

  const draggingRef = useRef({
    active: false,
    hasMoved: false,
    mx: 0,
    my: 0,
    px: 0,
    py: 0
  })

  /** Apply position directly to the DOM element — no React re-render needed */
  const applyPosition = useCallback((x: number, y: number) => {
    posRef.current = { x, y }
    if (containerRef.current) {
      containerRef.current.style.left = `${x}px`
      containerRef.current.style.top = `${y}px`
    }
    if (restoreRef.current) {
      restoreRef.current.style.left = `${x}px`
      restoreRef.current.style.top = `${y}px`
    }
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault() // Prevent focus / text-selection issues

    const state = draggingRef.current
    state.active = true
    state.hasMoved = false
    state.mx = e.clientX
    state.my = e.clientY
    state.px = posRef.current.x
    state.py = posRef.current.y

    // Disable pointer-events on ALL webviews so they don't steal mousemove
    document.querySelectorAll('webview').forEach((wv) => {
      ;(wv as HTMLElement).style.pointerEvents = 'none'
    })
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'grabbing'

    // Add a dragging class to disable CSS animations that conflict with transform
    containerRef.current?.classList.add('compass-wrap--dragging')
  }, [])

  useEffect(() => {
    const onMouseMove = (e: MouseEvent): void => {
      const state = draggingRef.current
      if (!state.active) return

      const dx = e.clientX - state.mx
      const dy = e.clientY - state.my

      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        state.hasMoved = true
      }

      let nextX = state.px + dx
      let nextY = state.py + dy

      // Boundary constraints
      const maxX = window.innerWidth - 70
      const maxY = window.innerHeight - 70
      nextX = Math.max(10, Math.min(nextX, maxX))
      nextY = Math.max(10, Math.min(nextY, maxY))

      // Direct DOM update — no React re-render, no RAF needed
      applyPosition(nextX, nextY)
    }

    const onMouseUp = (): void => {
      const state = draggingRef.current
      if (!state.active) return
      state.active = false

      // Re-enable pointer-events on webviews
      document.querySelectorAll('webview').forEach((wv) => {
        ;(wv as HTMLElement).style.pointerEvents = ''
      })
      document.body.style.userSelect = ''
      document.body.style.cursor = ''

      containerRef.current?.classList.remove('compass-wrap--dragging')
    }

    // Use capture phase to ensure we get events before anything else
    window.addEventListener('mousemove', onMouseMove, true)
    window.addEventListener('mouseup', onMouseUp, true)
    return () => {
      window.removeEventListener('mousemove', onMouseMove, true)
      window.removeEventListener('mouseup', onMouseUp, true)
    }
  }, [applyPosition])

  const handleCoreClick = useCallback((_e: React.MouseEvent) => {
    if (draggingRef.current.hasMoved) return
    setExpanded((prev) => !prev)
  }, [])

  if (hidden) {
    return (
      <button
        ref={restoreRef}
        className="compass-restore"
        style={{ left: posRef.current.x, top: posRef.current.y }}
        onClick={() => setHidden(false)}
        title="显示嗅探罗盘"
      >
        <img src={iconSvg} alt="" style={{ width: 18, height: 18 }} />
      </button>
    )
  }

  const radius = 65
  const buttons = [
    {
      key: 'start-stop',
      icon: active ? <PauseCircleOutlined /> : <PlayCircleOutlined />,
      title: active ? '停止嗅探' : '开始嗅探',
      color: active ? 'var(--color-error)' : 'var(--color-success)',
      onClick: () => (active ? onStop() : onStart())
    },
    {
      key: 'refresh',
      icon: <ReloadOutlined />,
      title: '扫描页面资源',
      onClick: onRefresh
    },
    {
      key: 'config',
      icon: <SettingOutlined />,
      title: '配置',
      onClick: onConfig
    },
    {
      key: 'hide',
      icon: <EyeOutlined />,
      title: '隐藏',
      onClick: () => setHidden(true)
    }
  ]

  return (
    <div
      ref={containerRef}
      className={`compass-wrap ${expanded ? 'compass-wrap--expanded' : ''} ${active ? 'compass-wrap--active' : ''}`}
      style={{
        left: posRef.current.x,
        top: posRef.current.y
      }}
    >
      <button
        className={`compass-core ${active ? 'compass-core--active' : ''}`}
        onMouseDown={handleMouseDown}
        onClick={handleCoreClick}
        title={expanded ? '收起' : '点击展开 / 拖动移动'}
      >
        <img src={iconSvg} className="compass-core__logo" alt="logo" />
        {active && <span className="compass-core__glow" />}
        {active && <span className="compass-core__pulse" />}
      </button>

      {/* Orbiting action buttons */}
      {buttons.map((btn, index) => {
        const angle = index * (360 / buttons.length) - 90
        const radian = (angle * Math.PI) / 180
        const tx = expanded ? Math.cos(radian) * radius : 0
        const ty = expanded ? Math.sin(radian) * radius : 0

        return (
          <Tooltip key={btn.key} title={btn.title} placement="top" mouseEnterDelay={0.3}>
            <button
              className="compass-action-btn"
              style={{
                transform: `translate(${tx}px, ${ty}px)`,
                scale: expanded ? '1' : '0',
                opacity: expanded ? 1 : 0,
                color: btn.color || 'inherit',
                borderColor: btn.color || 'var(--color-border)',
                visibility: expanded ? 'visible' : 'hidden'
              }}
              onClick={() => {
                btn.onClick()
                setExpanded(false)
              }}
            >
              <span className="compass-action-btn__icon">{btn.icon}</span>
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
}
