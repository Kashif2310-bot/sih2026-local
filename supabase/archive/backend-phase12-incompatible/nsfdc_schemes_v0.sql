-- NSFDC registry v0 seed — optional write-through / enrichment cache ONLY.
-- Authoritative scheme facts for the running prototype remain in TypeScript:
--   src/backend/registry/fixtureSchemeRegistry.ts (and future assistant scheme modules).
-- public.schemes here is NOT the multi-source government registry of record.
-- Stable UUIDs for cross-workstream fixtures.

insert into public.ministries (id, code, name_en, name_kn, level)
values (
  '11111111-1111-4111-8111-111111111101',
  'MOSJE',
  'Ministry of Social Justice and Empowerment',
  'ಸಾಮಾಜಿಕ ನ್ಯಾಯ ಮತ್ತು ಸಬಲೀಕರಣ ಸಚಿವಾಲಯ',
  'central'
)
on conflict (code) do nothing;

insert into public.departments (id, ministry_id, code, name_en, name_kn)
values (
  '11111111-1111-4111-8111-111111111102',
  '11111111-1111-4111-8111-111111111101',
  'NSFDC',
  'National Scheduled Castes Finance and Development Corporation',
  'ರಾಷ್ಟ್ರೀಯ ಪರಿಶಿಷ್ಟ ಜಾತಿ ಹಣಕಾಸು ಮತ್ತು ಅಭಿವೃದ್ಧಿ ನಿಗಮ'
)
on conflict (ministry_id, code) do nothing;

insert into public.scheme_sources (id, source_type, title_en, url, publisher, retrieved_at, confidence, status, notes_en)
values
(
  '44444444-4444-4444-8444-444444444402',
  'prototype_fixture',
  'LokPulse NSFDC constants (src/lib/config.ts)',
  null,
  'LokPulse SIH26091',
  '2026-09-16T00:00:00Z',
  1.0,
  'verified',
  'Authoritative numeric ladder for this prototype from SIH26091 / config.ts. Not live-scraped.'
),
(
  '44444444-4444-4444-8444-444444444401',
  'official_website',
  'NSFDC — official corporation site (reference)',
  'https://nsfdc.nic.in/',
  'NSFDC',
  '2026-09-16T00:00:00Z',
  0.7,
  'prototype_indicative',
  'Official domain reference only. Loan numbers come from locked PS constants, not a live scrape.'
)
on conflict (id) do nothing;

insert into public.schemes (
  id, code, name_en, name_kn, jurisdiction, owning_department_id, owning_ministry_id, status
) values
(
  '22222222-2222-4222-8222-222222222201',
  'NSFDC_MICRO_FINANCE',
  'NSFDC Micro Finance Scheme',
  'ಎನ್‌ಎಸ್‌ಎಫ್‌ಡಿಸಿ ಮೈಕ್ರೋ ಫೈನಾನ್ಸ್ ಯೋಜನೆ',
  'central',
  '11111111-1111-4111-8111-111111111102',
  '11111111-1111-4111-8111-111111111101',
  'active'
),
(
  '22222222-2222-4222-8222-222222222202',
  'NSFDC_TERM_LOAN',
  'NSFDC Term Loan Scheme',
  'ಎನ್‌ಎಸ್‌ಎಫ್‌ಡಿಸಿ ಟರ್ಮ್ ಲೋನ್ ಯೋಜನೆ',
  'central',
  '11111111-1111-4111-8111-111111111102',
  '11111111-1111-4111-8111-111111111101',
  'active'
)
on conflict (code) do nothing;

insert into public.scheme_versions (
  id, scheme_id, version, effective_from, loan_terms, benefits, subsidies,
  procedure_summary_en, procedure_summary_kn, official_urls, documents,
  eligibility_summary_en, eligibility_summary_kn, eligibility_hints,
  verification_status, published_at, retrieved_at, freshness_score
) values
(
  '33333333-3333-4333-8333-333333333301',
  '22222222-2222-4222-8222-222222222201',
  'v0.1.0',
  '2026-09-16T00:00:00Z',
  '{"projectCostMinRupees":1,"projectCostMaxRupees":140000,"loanRatio":0.9,"loanCapRupees":125000,"interestRatePercent":6.5,"tenureYears":3,"moratoriumMonths":3,"marginRatio":0.1}'::jsonb,
  '[{"kind":"loan","summaryEn":"Concessional micro finance loan up to 90% of project cost (cap ₹1.25 lakh).","summaryKn":"ಯೋಜನಾ ವೆಚ್ಚದ 90% ವರೆಗೆ ರಿಯಾಯಿತಿ ಮೈಕ್ರೋ ಫೈನಾನ್ಸ್ ಸಾಲ (ಗರಿಷ್ಠ ₹1.25 ಲಕ್ಷ)."}]'::jsonb,
  '[]'::jsonb,
  'Apply via NSFDC channelizing agency (SCA) / bank partner. Confirm exact process with local SCA — no live application API claimed.',
  'NSFDC SCA / ಬ್ಯಾಂಕ್ ಪಾರ್ಟ್‌ನರ್ ಮೂಲಕ ಅರ್ಜಿ. ನಿಖರ ಪ್ರಕ್ರಿಯೆಯನ್ನು ಸ್ಥಳೀಯ SCA ಯಿಂದ ದೃಢೀಕರಿಸಿ.',
  '["https://nsfdc.nic.in/"]'::jsonb,
  '[{"docType":"aadhaar","required":true,"labelEn":"Aadhaar card","labelKn":"ಆಧಾರ್","indicative":true}]'::jsonb,
  'NSFDC core schemes target Scheduled Caste beneficiaries; typical income ceiling ≤ ₹5 lakh.',
  'ಎನ್‌ಎಸ್‌ಎಫ್‌ಡಿಸಿ ಮುಖ್ಯ ಯೋಜನೆಗಳು ಪರಿಶಿಷ್ಟ ಜಾತಿಗೆ; ಆದಾಯ ಮಿತಿ ≤ ₹5 ಲಕ್ಷ.',
  '{"communitiesPreferred":["sc"],"maxAnnualIncomeRupees":500000,"womenPriority":true,"minAge":18,"maxAge":null,"businessCategories":null,"states":null}'::jsonb,
  'verified',
  '2026-09-16T00:00:00Z',
  '2026-09-16T00:00:00Z',
  1.0
),
(
  '33333333-3333-4333-8333-333333333302',
  '22222222-2222-4222-8222-222222222202',
  'v0.1.0',
  '2026-09-16T00:00:00Z',
  '{"projectCostMinRupees":140001,"projectCostMaxRupees":5000000,"loanRatio":0.9,"loanCapRupees":4500000,"interestRatePercent":8,"tenureYears":7,"moratoriumMonths":6,"marginRatio":0.1}'::jsonb,
  '[{"kind":"loan","summaryEn":"Concessional term loan up to 90% of project cost (cap ₹45 lakh).","summaryKn":"90% ವರೆಗೆ ಟರ್ಮ್ ಲೋನ್ (ಗರಿಷ್ಠ ₹45 ಲಕ್ಷ)."}]'::jsonb,
  '[]'::jsonb,
  'Apply via NSFDC channelizing agency (SCA) / bank partner. Confirm exact process with local SCA — no live application API claimed.',
  'NSFDC SCA / ಬ್ಯಾಂಕ್ ಪಾರ್ಟ್‌ನರ್ ಮೂಲಕ ಅರ್ಜಿ.',
  '["https://nsfdc.nic.in/"]'::jsonb,
  '[{"docType":"aadhaar","required":true,"labelEn":"Aadhaar card","labelKn":"ಆಧಾರ್","indicative":true}]'::jsonb,
  'NSFDC core schemes target Scheduled Caste beneficiaries; typical income ceiling ≤ ₹5 lakh.',
  'ಎನ್‌ಎಸ್‌ಎಫ್‌ಡಿಸಿ ಮುಖ್ಯ ಯೋಜನೆಗಳು ಪರಿಶಿಷ್ಟ ಜಾತಿಗೆ; ಆದಾಯ ಮಿತಿ ≤ ₹5 ಲಕ್ಷ.',
  '{"communitiesPreferred":["sc"],"maxAnnualIncomeRupees":500000,"womenPriority":true,"minAge":18,"maxAge":null,"businessCategories":null,"states":null}'::jsonb,
  'verified',
  '2026-09-16T00:00:00Z',
  '2026-09-16T00:00:00Z',
  1.0
)
on conflict (scheme_id, version) do nothing;

insert into public.scheme_version_sources (scheme_version_id, source_id, is_primary) values
  ('33333333-3333-4333-8333-333333333301', '44444444-4444-4444-8444-444444444402', true),
  ('33333333-3333-4333-8333-333333333301', '44444444-4444-4444-8444-444444444401', false),
  ('33333333-3333-4333-8333-333333333302', '44444444-4444-4444-8444-444444444402', true),
  ('33333333-3333-4333-8333-333333333302', '44444444-4444-4444-8444-444444444401', false)
on conflict do nothing;
