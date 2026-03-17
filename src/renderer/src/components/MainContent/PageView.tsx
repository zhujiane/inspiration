import ResourcePage from '../../pages/resource'
import SetupPage from '../../pages/config'
import type { Tab } from '../../features/browser/types'

interface PageViewProps {
  active: boolean
  tab: Tab
}

export default function PageView({ active, tab }: PageViewProps): React.JSX.Element {
  const style = {
    display: active ? 'block' : 'none',
    height: '100%',
    width: '100%',
    overflow: 'auto'
  } as const

  if (tab.type === 'resource') {
    return (
      <div key={tab.id} style={style}>
        <ResourcePage />
      </div>
    )
  }

  return (
    <div key={tab.id} style={style}>
      <SetupPage />
    </div>
  )
}
