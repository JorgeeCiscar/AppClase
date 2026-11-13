import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { Api } from '../shared/types'

const invoke = (channel: string) => (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)
function subscribe<T>(channel: string, cb: (p: T) => void): () => void {
  const listener = (_e: unknown, p: T): void => cb(p)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: Api = {
  subjects: {
    list: invoke('subjects:list'),
    save: invoke('subjects:save'),
    remove: invoke('subjects:remove'),
    seedDaw1: invoke('subjects:seedDaw1')
  },
  units: { list: invoke('units:list'), save: invoke('units:save'), remove: invoke('units:remove') },
  items: {
    list: invoke('items:list'),
    get: invoke('items:get'),
    save: invoke('items:save'),
    remove: invoke('items:remove'),
    setStatus: invoke('items:setStatus'),
    addTag: invoke('items:addTag'),
    removeTag: invoke('items:removeTag')
  },
  files: {
    list: invoke('files:list'),
    choose: invoke('files:choose'),
    chooseFolder: invoke('files:chooseFolder'),
    addPaths: invoke('files:addPaths'),
    remove: invoke('files:remove'),
    open: invoke('files:open'),
    openWith: invoke('files:openWith'),
    reveal: invoke('files:reveal'),
    relocate: invoke('files:relocate'),
    revalidate: invoke('files:revalidate')
  },
  tags: invoke('tags'),
  search: invoke('search'),
  stats: invoke('stats'),
  settings: {
    get: invoke('settings:get'),
    save: invoke('settings:save'),
    chooseExecutable: invoke('settings:chooseExecutable'),
    chooseDownloadsDir: invoke('settings:chooseDownloadsDir')
  },
  importer: {
    read: invoke('importer:read'),
    cancel: invoke('importer:cancel'),
    download: invoke('importer:download'),
    logout: invoke('importer:logout')
  },
  app: {
    version: invoke('app:version'),
    // Electron 32 quitó File.path: la ruta de un fichero soltado se obtiene así.
    pathForFile: (file: File) => webUtils.getPathForFile(file),
    updateStatus: invoke('update:status'),
    checkForUpdates: invoke('update:check'),
    installUpdate: invoke('update:install'),
    onUpdateStatus: (cb) => subscribe('update:status', cb)
  }
} as Api

contextBridge.exposeInMainWorld('api', api)
