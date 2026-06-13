import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import OAuthAuthorizationFlow from '../OAuthAuthorizationFlow.vue'

vi.mock('@/stores/app', () => ({
  useAppStore: () => ({
    showSuccess: vi.fn(),
    showError: vi.fn()
  })
}))

vi.mock('vue-i18n', async () => {
  const actual = await vi.importActual<typeof import('vue-i18n')>('vue-i18n')
  return {
    ...actual,
    useI18n: () => ({
      t: (key: string) => key
    })
  }
})

describe('OAuthAuthorizationFlow', () => {
  it('opens generated authorization URL in a new tab', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)

    const wrapper = mount(OAuthAuthorizationFlow, {
      props: {
        addMethod: 'oauth',
        authUrl: 'https://auth.example/oauth',
        platform: 'openai',
        showCookieOption: false,
        showRefreshTokenOption: false
      },
      global: {
        stubs: {
          Icon: true
        }
      }
    })

    await wrapper.get('[data-testid="oauth-open-auth-url"]').trigger('click')

    expect(openSpy).toHaveBeenCalledWith(
      'https://auth.example/oauth',
      '_blank',
      'noopener,noreferrer'
    )

    openSpy.mockRestore()
  })
})
