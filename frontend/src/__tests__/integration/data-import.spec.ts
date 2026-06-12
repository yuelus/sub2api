import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ImportDataModal from '@/components/admin/account/ImportDataModal.vue'
import { adminAPI } from '@/api/admin'

const showError = vi.fn()
const showSuccess = vi.fn()

vi.mock('@/stores/app', () => ({
  useAppStore: () => ({
    showError,
    showSuccess
  })
}))

vi.mock('@/api/admin', () => ({
  adminAPI: {
    accounts: {
      importData: vi.fn()
    }
  }
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key
  })
}))

describe('ImportDataModal', () => {
  beforeEach(() => {
    showError.mockReset()
    showSuccess.mockReset()
    vi.mocked(adminAPI.accounts.importData).mockReset()
  })

  it('未选择文件时提示错误', async () => {
    const wrapper = mount(ImportDataModal, {
      props: { show: true },
      global: {
        stubs: {
          BaseDialog: { template: '<div><slot /><slot name="footer" /></div>' }
        }
      }
    })

    await wrapper.find('form').trigger('submit')
    expect(showError).toHaveBeenCalledWith('admin.accounts.dataImportSelectFile')
  })


  it('支持批量选择 JSON 文件并带入导入分组', async () => {
    vi.mocked(adminAPI.accounts.importData)
      .mockResolvedValueOnce({
        proxy_created: 1,
        proxy_reused: 0,
        proxy_failed: 0,
        account_created: 1,
        account_failed: 0,
        errors: []
      })
      .mockResolvedValueOnce({
        proxy_created: 0,
        proxy_reused: 1,
        proxy_failed: 0,
        account_created: 2,
        account_failed: 0,
        errors: []
      })

    const wrapper = mount(ImportDataModal, {
      props: {
        show: true,
        groups: [
          {
            id: 9,
            name: 'Group 9',
            platform: 'openai',
            subscription_type: 'chatgpt_plus',
            rate_multiplier: 1,
            account_count: 0
          }
        ] as any
      },
      global: {
        stubs: {
          BaseDialog: { template: '<div><slot /><slot name="footer" /></div>' },
          GroupSelector: {
            props: ['modelValue', 'groups'],
            emits: ['update:modelValue'],
            template:
              '<button type="button" data-test="groups" @click="$emit(\'update:modelValue\', [9])">groups</button>'
          }
        }
      }
    })

    await wrapper.find('[data-test="groups"]').trigger('click')

    const input = wrapper.find('input[type="file"]')
    const first = new File(['{}'], 'b.json', { type: 'application/json' })
    Object.defineProperty(first, 'text', {
      value: () =>
        Promise.resolve(
          JSON.stringify({ exported_at: '2026-06-12T00:00:00Z', proxies: [], accounts: [{ name: 'b' }] })
        )
    })
    const second = new File(['{}'], 'a.json', { type: 'application/json' })
    Object.defineProperty(second, 'text', {
      value: () =>
        Promise.resolve(
          JSON.stringify({ exported_at: '2026-06-12T00:00:00Z', proxies: [], accounts: [{ name: 'a' }] })
        )
    })
    Object.defineProperty(input.element, 'files', {
      value: [first, second]
    })

    await input.trigger('change')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(adminAPI.accounts.importData).toHaveBeenCalledTimes(2)
    expect(adminAPI.accounts.importData).toHaveBeenNthCalledWith(1, {
      data: { exported_at: '2026-06-12T00:00:00Z', proxies: [], accounts: [{ name: 'a' }] },
      skip_default_group_bind: true,
      group_ids: [9]
    })
    expect(adminAPI.accounts.importData).toHaveBeenNthCalledWith(2, {
      data: { exported_at: '2026-06-12T00:00:00Z', proxies: [], accounts: [{ name: 'b' }] },
      skip_default_group_bind: true,
      group_ids: [9]
    })
    expect(showSuccess).toHaveBeenCalledWith('admin.accounts.dataImportSuccess')
  })

  it('无效 JSON 时提示解析失败', async () => {
    const wrapper = mount(ImportDataModal, {
      props: { show: true },
      global: {
        stubs: {
          BaseDialog: { template: '<div><slot /><slot name="footer" /></div>' }
        }
      }
    })

    const input = wrapper.find('input[type="file"]')
    const file = new File(['invalid json'], 'data.json', { type: 'application/json' })
    Object.defineProperty(file, 'text', {
      value: () => Promise.resolve('invalid json')
    })
    Object.defineProperty(input.element, 'files', {
      value: [file]
    })

    await input.trigger('change')
    await wrapper.find('form').trigger('submit')
    await Promise.resolve()

    expect(showError).toHaveBeenCalledWith('admin.accounts.dataImportParseFailed')
  })
})
