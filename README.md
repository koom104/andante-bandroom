# Bandroom

밴드부 합주실 예약을 위한 모바일 우선 웹앱입니다.

## 과거 합주 기록과 리캡

- 기존 DB에는 `supabase/patch-041-notion-rehearsal-history.sql`을 적용합니다. 새 DB용 `schema.sql`에도 포함되어 있습니다.
- 패치는 과거 합주를 저장할 구조와 조회 함수를 추가합니다. 실제 Notion 예약·셋리스트 자료는 별도 import SQL로 반영해야 합니다. 개인정보가 포함된 자료는 저장소에 포함하지 않습니다.
- 과거 시간은 예약과 셋리스트 기준이며 실제 출석을 확인한 기록은 아닙니다. 같은 예약을 다시 가져와도 중복 집계하지 않습니다. 기존 예약이 있으면 취소 상태까지 우선합니다.
- 공동 예약은 원래 예약 시간을 보존하고 곡별 인정 시간을 따로 저장합니다. 전체합주는 공연별로 한 번만 집계합니다.
- 합주 목표는 화면 위부터 가을공연, 가을축제, 동연제, 여름공연, 봄공연, 대동제 순서입니다.
- `supabase/patch-043-other-rehearsal-goal.sql`은 기타 목표를 추가하고 기존 졸업 공연·졸업공연 목표 및 관련 팀·예약을 기타로 통합합니다. 팀원과 예약 시간은 유지합니다.
- 리캡은 선택한 연도의 1~12월 중 활동 시간이 있는 달을 표시합니다. 전체 기간에서는 여러 연도의 활동한 달을 표시합니다.
- 캘린더는 예약 이름을 나열하는 전체보기와 날짜를 선택하는 기존 상세보기를 유지합니다. 전체보기에서만 내 팀 예약의 색상을 진하게 표시합니다. 상단의 이전·오늘·다음 버튼으로 3주씩 이동하며 과거 예약을 조회하고, ‘날짜로 이동’ 메뉴에서 특정 날짜를 선택할 수 있습니다.

팀 단위 예약, 팀장 예약 관리, 개인 시간표, 날짜별 시간표 예외, 관리자 승인, 합주 목표 관리, 합주 시간 리더보드를 포함합니다.

## 기술 스택

- Vinext
- React
- Supabase Auth + Postgres
- Cloudflare Workers
- Tailwind CSS

## 주요 기능

- 회원가입 후 관리자 승인
- 팀 생성 및 팀장 기준 팀 편집
- 팀원 세션 지정
- 합주 목표 카테고리 관리
- 10:00-24:00, 30분 단위 시간표 편집
- 고정 요일 시간표와 날짜별 시간표 예외
- 팀장만 예약 생성 가능
- 전원 가능, 일부 가능, 예약 완료 시간대 필터
- 예약 시점 기준 참여 멤버 스냅샷 저장
- 웹푸시 알림: 당일 오전 9시 일정 요약, 합주 30분 전, 일정 추가/취소
- 마이페이지 누적 합주 시간 및 상위 10명 리더보드
- 관리자 예약 취소 및 부원 시간표 수정

## 로컬 실행

Node.js 22 이상이 필요합니다.

```bash
pnpm install
pnpm dev
```

브라우저에서 `http://localhost:3000`을 엽니다.

## 환경변수

`.env.example`을 `.env.local`로 복사해서 사용합니다.

```bash
cp .env.example .env.local
```

필수 값:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
WEB_PUSH_PUBLIC_KEY=
WEB_PUSH_PRIVATE_KEY=
WEB_PUSH_SUBJECT=mailto:your-email@example.com
```

`SUPABASE_SERVICE_ROLE_KEY`는 관리자 비밀번호 리셋 API에서 필요합니다. 저장소에 실제 service role key를 커밋하지 말고, 배포 환경변수/시크릿으로만 설정하세요.
`WEB_PUSH_PRIVATE_KEY`도 저장소에 커밋하지 말고 배포 환경변수/시크릿으로만 설정하세요.

## Supabase 설정

Supabase 프로젝트를 만든 뒤 SQL Editor에서 아래 순서로 실행합니다.

1. `supabase/schema.sql`
2. 필요한 경우 패치 파일을 번호 순서대로 실행
   - `supabase/patch-007-bass-session.sql`
   - `supabase/patch-008-goal-categories.sql`
   - `supabase/patch-009-club-room-status.sql`
   - `supabase/patch-010-team-date-schedule-signup.sql`
   - `supabase/patch-011-booking-attendance-snapshot.sql`
   - `supabase/patch-012-member-schedules-update-policy.sql`
   - `supabase/patch-013-save-weekly-schedule-rpc.sql`
   - `supabase/patch-014-rehearsal-leaderboard-rpc.sql`
   - `supabase/patch-015-team-rehearsal-totals.sql`
   - `supabase/patch-016-password-reset.sql`
   - `supabase/patch-017-manager-role.sql`
   - `supabase/patch-018-web-push.sql`
   - `supabase/patch-019-web-push-rpc.sql`
   - `supabase/patch-020-booking-push-targets.sql`

새 프로젝트에서는 보통 `supabase/schema.sql`만 실행하면 최신 구조가 포함됩니다.

기존 프로젝트에서 이어서 적용하는 경우에는 누락된 패치를 번호 순서대로 실행합니다.

## 관리자 계정

신규 가입은 이메일과 관계없이 일반 부원·승인 대기로 생성됩니다. 최초 관리자는 Supabase Auth 가입 후 본인 확인을 마친 사용자의 UUID로 SQL Editor에서 명시적으로 지정합니다.

```sql
update public.profiles
set role = 'admin', status = 'approved', approved_at = now()
where id = '확인한-사용자-UUID'::uuid;
```

기존 DB는 `supabase/patch-042-explicit-admin-provisioning.sql`을 적용하면 이메일 기반 자동 관리자 승격을 제거할 수 있습니다. 기존 관리자와 승인 상태는 바뀌지 않습니다.

## 빌드

```bash
pnpm build
```

## Cloudflare Workers 배포

Wrangler 로그인이 필요합니다.

```bash
pnpm exec wrangler login
pnpm run deploy:cloudflare
```

이 명령은 앱 배포 후 오전 9시 브리핑(`0 0 * * *`, UTC)과 5분 간격 예약 알림 Cron을 함께 다시 연결합니다.

Cloudflare 환경변수에는 다음 값을 설정합니다.

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
WEB_PUSH_PUBLIC_KEY=
WEB_PUSH_SUBJECT=mailto:your-email@example.com
```

Cloudflare secret에는 다음 값을 설정합니다.

```bash
pnpm exec wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config dist/server/wrangler.json --name bandroom-ai
pnpm exec wrangler secret put WEB_PUSH_PRIVATE_KEY --config dist/server/wrangler.json --name bandroom-ai
```

웹푸시 VAPID 키는 P-256 키쌍입니다. 공개키(`WEB_PUSH_PUBLIC_KEY`)는 URL-safe base64 형식의 uncompressed public key, 개인키(`WEB_PUSH_PRIVATE_KEY`)는 URL-safe base64 형식의 private key scalar를 사용합니다.

## 재현 체크리스트

1. GitHub 저장소 clone
2. `pnpm install`
3. `.env.local` 작성
4. Supabase SQL 실행
5. `pnpm dev`로 로컬 확인
6. `pnpm build`
7. Wrangler로 배포

이 순서대로 진행하면 현재 배포된 Andante 웹앱과 같은 구조로 재현할 수 있습니다.
