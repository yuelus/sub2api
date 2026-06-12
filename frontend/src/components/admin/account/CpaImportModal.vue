<template>
  <BaseDialog :show="show" :title="t('admin.accounts.cpaImportTitle')" width="normal" close-on-click-outside @close="handleClose">
    <form id="cpa-import-form" class="space-y-4" @submit.prevent="handleImport">
      <div class="text-sm text-gray-600 dark:text-dark-300">{{ t('admin.accounts.cpaImportHint') }}</div>
      <div>
        <label class="input-label">{{ t('admin.accounts.cpaImportFile') }}</label>
        <div class="flex items-center justify-between gap-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3 dark:border-dark-600 dark:bg-dark-800">
          <div class="min-w-0">
            <div class="truncate text-sm text-gray-700 dark:text-dark-200">{{ fileText || t('admin.accounts.cpaImportSelectFile') }}</div>
            <div class="text-xs text-gray-500 dark:text-dark-400">JSON (.json)</div>
          </div>
          <button type="button" class="btn btn-secondary shrink-0" @click="fileInput?.click()">{{ t('common.chooseFile') }}</button>
        </div>
        <input ref="fileInput" type="file" class="hidden" accept="application/json,.json" multiple @change="handleFileChange" />
      </div>
      <div>
        <label class="input-label">{{ t('admin.accounts.dataImportGroups') }}</label>
        <GroupSelector v-model="groupIds" :groups="groups" :show-label="false" />
        <p class="input-hint">{{ t('admin.accounts.dataImportGroupsHint') }}</p>
      </div>
    </form>

    <template #footer>
      <div class="flex justify-end gap-3">
        <button class="btn btn-secondary" type="button" :disabled="importing" @click="handleClose">{{ t('common.cancel') }}</button>
        <button class="btn btn-primary" type="submit" form="cpa-import-form" :disabled="importing">
          {{ importing ? t('admin.accounts.dataImporting') : t('admin.accounts.dataImportButton') }}
        </button>
      </div>
    </template>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseDialog from '@/components/common/BaseDialog.vue'
import GroupSelector from '@/components/common/GroupSelector.vue'
import { adminAPI } from '@/api/admin'
import { useAppStore } from '@/stores/app'
import type { AdminDataAccount, AdminGroup } from '@/types'

interface Props { show: boolean; groups?: AdminGroup[] }
interface Emits {
  (e: 'close'): void
  (e: 'imported'): void
}

const props = withDefaults(defineProps<Props>(), {
  groups: () => []
})
const emit = defineEmits<Emits>()
const { t } = useI18n()
const appStore = useAppStore()

const importing = ref(false)
const files = ref<File[]>([])
const groupIds = ref<number[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const fileText = computed(() => files.value.length > 1 ? t('admin.accounts.cpaImportFileCount', { count: files.value.length }) : files.value[0]?.name || '')
const groups = computed(() => props.groups)

watch(() => props.show, (open) => {
  if (!open) return
  files.value = []
  groupIds.value = []
  if (fileInput.value) fileInput.value.value = ''
})

const handleFileChange = (event: Event) => {
  const target = event.target as HTMLInputElement
  files.value = Array.from(target.files || []).sort((a, b) => a.name.localeCompare(b.name))
}

const handleClose = () => {
  if (!importing.value) emit('close')
}

const readFile = async (file: File) => file.text ? file.text() : new TextDecoder().decode(await file.arrayBuffer())

const decodeJwtPayload = (token: string): Record<string, any> => {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return {}
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = payload + '='.repeat((4 - payload.length % 4) % 4)
    return JSON.parse(decodeURIComponent(Array.from(atob(padded), c => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join('')))
  } catch {
    return {}
  }
}

const parseExpiredTime = (value: unknown) => {
  if (typeof value !== 'string' || !value) return 0
  const ts = Date.parse(value)
  return Number.isNaN(ts) ? 0 : Math.floor(ts / 1000)
}

const convertCpaAccount = (data: Record<string, any>, index: number): AdminDataAccount => {
  const jwtPayload = decodeJwtPayload(data.access_token || '')
  const authInfo = jwtPayload['https://api.openai.com/auth'] || {}
  const idTokenAuth = decodeJwtPayload(data.id_token || '')['https://api.openai.com/auth'] || {}
  const organizations = Array.isArray(idTokenAuth.organizations) ? idTokenAuth.organizations : []
  const expiresAt = parseExpiredTime(data.expired) || jwtPayload.exp || 0
  const type = data.type || 'unknown'

  return {
    name: `${type}-普号-${String(index).padStart(4, '0')}`,
    platform: 'openai',
    type: 'oauth',
    credentials: {
      access_token: data.access_token || '',
      chatgpt_account_id: data.account_id || '',
      chatgpt_user_id: authInfo.chatgpt_user_id || '',
      expires_at: expiresAt,
      expires_in: 864000,
      organization_id: organizations[0]?.id || '',
      refresh_token: data.refresh_token || ''
    },
    extra: { email: data.email || '' },
    concurrency: 10,
    priority: 1,
    rate_multiplier: 1,
    auto_pause_on_expired: true
  }
}

const handleImport = async () => {
  if (files.value.length === 0) {
    appStore.showError(t('admin.accounts.cpaImportSelectFile'))
    return
  }

  importing.value = true
  try {
    const accounts: AdminDataAccount[] = []
    for (const file of files.value) {
      const data = JSON.parse(await readFile(file))
      if (!data?.access_token || !data?.account_id) continue
      accounts.push(convertCpaAccount(data, accounts.length + 1))
    }

    if (accounts.length === 0) {
      appStore.showError(t('admin.accounts.cpaImportNoValidAccounts'))
      return
    }

    const selectedGroupIds = [...groupIds.value]
    const res = await adminAPI.accounts.importData({
      data: { exported_at: new Date().toISOString(), proxies: [], accounts },
      skip_default_group_bind: true,
      group_ids: selectedGroupIds.length > 0 ? selectedGroupIds : undefined
    })

    const msgParams: Record<string, unknown> = {
      account_created: res.account_created,
      account_failed: res.account_failed,
      proxy_created: res.proxy_created,
      proxy_reused: res.proxy_reused,
      proxy_failed: res.proxy_failed
    }
    if (res.account_failed > 0 || res.proxy_failed > 0) {
      appStore.showError(t('admin.accounts.dataImportCompletedWithErrors', msgParams))
    } else {
      appStore.showSuccess(t('admin.accounts.dataImportSuccess', msgParams))
      emit('imported')
    }
  } catch (error: any) {
    appStore.showError(error instanceof SyntaxError ? t('admin.accounts.dataImportParseFailed') : error?.message || t('admin.accounts.dataImportFailed'))
  } finally {
    importing.value = false
  }
}
</script>
