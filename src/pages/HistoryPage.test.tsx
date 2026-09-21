/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AUTH_STORAGE_KEY } from '../lib/authSession'
import i18n from '../i18n'
import { AuthProvider } from '../state/AuthContext'
import { HistoryPage } from './HistoryPage'

const listUserAssessments = vi.fn()

vi.mock('../lib/api', () => ({
  listUserAssessments: (...args: unknown[]) => listUserAssessments(...args),
}))

const user = {
  id: 'user-1',
  phone: '9876543210',
  name: 'Lakshmi S.',
  preferred_language: 'en',
  role: 'beneficiary',
  created_at: '2026-09-20T00:00:00Z',
}

function renderHistory() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={['/history']}>
        <Routes>
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/login" element={<div>login-ok</div>} />
          <Route path="/pulse/:id" element={<div>case</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  )
}

describe('history list', () => {
  beforeEach(async () => {
    localStorage.clear()
    listUserAssessments.mockReset()
    await i18n.changeLanguage('en')
  })

  afterEach(() => {
    cleanup()
  })

  it('asks a guest to log in and does not fetch', () => {
    renderHistory()
    expect(screen.getByText('Log in to see your past scans.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Log in' }).getAttribute('href')).toBe('/login')
    expect(listUserAssessments).not.toHaveBeenCalled()
  })

  it('lists the user cases newest first and links each to the saved case', async () => {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ token: 'tok-1', user }))
    listUserAssessments.mockResolvedValue([
      {
        id: 'old-id',
        user_id: user.id,
        location_label: 'Older village',
        lat: 1,
        lng: 2,
        business_category: 'dairy',
        margin_paise: 100000,
        project_cost_paise: 1000000,
        loan_paise: 900000,
        scheme: 'micro',
        lokscore: 40,
        lokscore_grade: 'C',
        data_status: 'incomplete',
        inputs_json: {},
        outputs_json: {},
        app_version: 'first',
        created_at: '2026-09-19T10:00:00Z',
      },
      {
        id: 'new-id',
        user_id: user.id,
        location_label: 'Newer village',
        lat: 1,
        lng: 2,
        business_category: 'textiles',
        margin_paise: 3750000,
        project_cost_paise: 37500000,
        loan_paise: 33750000,
        scheme: 'term',
        lokscore: 72,
        lokscore_grade: 'B',
        data_status: 'complete',
        inputs_json: {},
        outputs_json: {},
        app_version: 'second',
        created_at: '2026-09-20T10:00:00Z',
      },
    ])
    renderHistory()
    await waitFor(() => expect(listUserAssessments).toHaveBeenCalledWith('user-1', 'tok-1'))
    const list = await screen.findByTestId('history-list')
    const items = list.querySelectorAll('li')
    expect(items).toHaveLength(2)
    expect(items[0].textContent).toContain('Newer village')
    expect(items[1].textContent).toContain('Older village')
    expect(items[0].querySelector('a')?.getAttribute('href')).toBe('/pulse/new-id')
    expect(items[1].querySelector('a')?.getAttribute('href')).toBe('/pulse/old-id')
  })
})
