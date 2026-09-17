-- Optional scheme CACHE seed — NOT the scheme source of truth.
-- SoT: src/assistant/data/schemes.ts (ids must match exactly).
-- Only NSFDC entries that reuse config.ts constants; other schemes.ts
-- entries stay local-only until a verified enrichment write occurs.

insert into public.schemes (
  id, name, description, scope, state, sector,
  eligibility, benefits, application,
  source_url, source_name, source_type,
  verification_status, last_verified_at, retrieved_at, updated_at
) values
(
  'nsfdc-micro-finance',
  'NSFDC Micro Finance Scheme (MFS)',
  'Cache mirror of curated local scheme — confirm against official channel before applying.',
  'central',
  null,
  array['any'],
  '{"socialCategories":["sc"],"maxAnnualIncome":500000}'::jsonb,
  '{"loanCapRupees":125000,"ratePercent":6.5}'::jsonb,
  '{"documents":["Caste certificate (SC)"],"steps":["Apply via SCA / channel partner"]}'::jsonb,
  'https://nsfdc.nic.in/',
  'NSFDC',
  'official_ministry',
  'verified_local',
  '2026-09-12T00:00:00Z',
  '2026-09-17T00:00:00Z',
  now()
),
(
  'nsfdc-term-loan',
  'NSFDC Term Loan Scheme',
  'Cache mirror of curated local scheme — confirm against official channel before applying.',
  'central',
  null,
  array['any'],
  '{"socialCategories":["sc"],"maxAnnualIncome":500000}'::jsonb,
  '{"loanCapRupees":4500000,"ratePercent":8}'::jsonb,
  '{"documents":["Caste certificate (SC)"],"steps":["Apply via SCA / channel partner"]}'::jsonb,
  'https://nsfdc.nic.in/',
  'NSFDC',
  'official_ministry',
  'verified_local',
  '2026-09-12T00:00:00Z',
  '2026-09-17T00:00:00Z',
  now()
)
on conflict (id) do update set
  name = excluded.name,
  description = excluded.description,
  verification_status = excluded.verification_status,
  updated_at = now();

insert into public.ministries (id, code, name_en, name_kn) values
  ('agriculture', 'AGRI', 'Ministry of Agriculture & Farmers Welfare', 'ಕೃಷಿ ಮತ್ತು ರೈತರ ಕಲ್ಯಾಣ ಸಚಿವಾಲಯ'),
  ('animal_husbandry', 'AHD', 'Animal Husbandry & Dairying', 'ಪಶುಸಂಗೋಪನೆ ಮತ್ತು ಹೈನುಗಾರಿಕೆ'),
  ('msme', 'MSME', 'Ministry of MSME', 'ಸೂಕ್ಷ್ಮ, ಸಣ್ಣ ಮತ್ತು ಮಧ್ಯಮ ಉದ್ಯಮ ಸಚಿವಾಲಯ'),
  ('rural_development', 'MRD', 'Ministry of Rural Development', 'ಗ್ರಾಮೀಣ ಅಭಿವೃದ್ಧಿ ಸಚಿವಾಲಯ'),
  ('finance', 'DFS', 'Department of Financial Services', 'ಹಣಕಾಸು ಸೇವೆಗಳ ಇಲಾಖೆ'),
  ('women_child', 'WCD', 'Women & Child Development', 'ಮಹಿಳಾ ಮತ್ತು ಮಕ್ಕಳ ಅಭಿವೃದ್ಧಿ ಇಲಾಖೆ'),
  ('social_justice', 'MOSJE', 'Social Justice & Empowerment', 'ಸಾಮಾಜಿಕ ನ್ಯಾಯ ಮತ್ತು ಸಬಲೀಕರಣ ಸಚಿವಾಲಯ')
on conflict (id) do update set
  code = excluded.code,
  name_en = excluded.name_en,
  name_kn = excluded.name_kn;

insert into public.departments (id, ministry_id, code, name_en, name_kn) values
  ('nsfdc', 'social_justice', 'NSFDC', 'National Scheduled Castes Finance and Development Corporation', 'ಎನ್‌ಎಸ್‌ಎಫ್‌ಡಿಸಿ')
on conflict (id) do update set
  ministry_id = excluded.ministry_id,
  name_en = excluded.name_en;

insert into public.scheme_ministry_map (scheme_id, ministry_id, department_id) values
  ('nsfdc-micro-finance', 'social_justice', 'nsfdc'),
  ('nsfdc-term-loan', 'social_justice', 'nsfdc'),
  ('nbcfdc-term-loan', 'social_justice', null),
  ('pmegp', 'msme', null),
  ('pm-mudra-yojana', 'finance', null),
  ('stand-up-india', 'finance', null),
  ('pm-vishwakarma', 'msme', null),
  ('kudumbashree-microenterprise', 'women_child', null)
on conflict do nothing;
