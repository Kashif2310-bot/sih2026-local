/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import i18n from '../i18n'
import { AuthProvider } from '../state/AuthContext'
import { LoginPage } from './LoginPage'

vi.mock('../state/useApp', () => ({
  useApp: () => ({ assessmentId: null }),
}))

const requestOtp = vi.fn()
const verifyOtp = vi.fn()
const claimAssessment = vi.fn()

vi.mock('../lib/api', () => ({
  ApiError: class ApiError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.status = status
    }
  },
  requestOtp: (...args: unknown[]) => requestOtp(...args),
  verifyOtp: (...args: unknown[]) => verifyOtp(...args),
  claimAssessment: (...args: unknown[]) => claimAssessment(...args),
}))

function renderLogin() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/history" element={<div>history-ok</div>} />
          <Route path="/scan" element={<div>scan-ok</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

const DEMO = 'Demo OTP - any phone works, code 123456'

describe('login screen', () => {
  beforeEach(async () => {
    localStorage.clear()
    requestOtp.mockReset()
    verifyOtp.mockReset()
    claimAssessment.mockReset()
    requestOtp.mockResolvedValue({ phone: '9876543210', code: '123456' })
    verifyOtp.mockResolvedValue({
      token: 'tok-1',
      user: {
        id: 'user-1',
        phone: '9876543210',
        name: '9876543210',
        preferred_language: 'en',
        role: 'beneficiary',
        created_at: '2026-09-20T00:00:00Z',
      },
    })
    await i18n.changeLanguage('en')
  })

  afterEach(() => {
    cleanup()
  })

  it('shows the demo OTP sentence in English and Kannada', async () => {
    renderLogin()
    expect(screen.getByTestId('demo-otp-hint').textContent).toBe(DEMO)
    await i18n.changeLanguage('kn')
    expect(screen.getByTestId('demo-otp-hint').textContent).toBe(DEMO)
  })

  it('goes phone then OTP, then lands on history', async () => {
    renderLogin()
    fireEvent.change(screen.getByPlaceholderText('10-digit mobile'), {
      target: { value: '9876543210' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send OTP' }))
    await waitFor(() => expect(requestOtp).toHaveBeenCalledWith('9876543210'))
    fireEvent.change(screen.getByPlaceholderText('123456'), {
      target: { value: '123456' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    await waitFor(() => expect(verifyOtp).toHaveBeenCalledWith('9876543210', '123456'))
    await waitFor(() => expect(screen.getByText('history-ok')).toBeTruthy())
  })

  it('keeps a guest path to Scan without forcing login', () => {
    renderLogin()
    const guest = screen.getByRole('link', { name: 'Continue without login' })
    expect(guest.getAttribute('href')).toBe('/scan')
  })
})
