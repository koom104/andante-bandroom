# Bandromm

밴드부 합주실 예약을 위한 모바일 우선 웹앱입니다.

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

`supabase/schema.sql` 하단의 관리자 이메일 조건을 실제 관리자 이메일로 바꾼 뒤 실행합니다.

```sql
where lower(email) = 'your-admin-email@example.com'
```

관리자는 Supabase Auth에 먼저 가입되어 있어야 하며, SQL 실행 후 `profiles`에서 관리자/승인 상태로 보정됩니다.

## 빌드

```bash
pnpm build
```

## Cloudflare Workers 배포

Wrangler 로그인이 필요합니다.

```bash
pnpm exec wrangler login
pnpm build
pnpm exec wrangler deploy --config dist/server/wrangler.json --name bandroom-ai --keep-vars
```

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
