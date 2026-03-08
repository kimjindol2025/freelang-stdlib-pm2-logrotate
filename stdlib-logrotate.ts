/**
 * FreeLang v2 - stdlib-logrotate
 *
 * pm2-logrotate npm 패키지 완전 대체
 * 로그 파일 로테이션 / 압축 / 정리 네이티브 구현
 *
 * 제공 네이티브 함수:
 *   logrotate_file_size(path)            → number  (바이트)
 *   logrotate_rotate_file(path, maxN)    → string  (결과 메시지)
 *   logrotate_compress_file(path)        → string  (생성된 .gz 경로)
 *   logrotate_cleanup_dir(dir, maxFiles) → number  (삭제된 파일 수)
 *   logrotate_list_log_files(dir, base)  → string  (JSON 배열)
 *   logrotate_parse_size(sizeStr)        → number  (바이트 변환: "10M" → 10485760)
 *   logrotate_now_unix()                 → number  (Unix timestamp ms)
 *   logrotate_cron_matches(expr, now)    → bool    (cron 표현식 매칭)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { NativeFunctionRegistry } from './vm/native-function-registry';

// ─────────────────────────────────────────────────────────────
// 내부 헬퍼
// ─────────────────────────────────────────────────────────────

/**
 * 크기 문자열 → 바이트 변환
 * "10M" → 10485760, "100K" → 102400, "1G" → 1073741824
 */
function parseSizeToBytes(sizeStr: string): number {
  if (!sizeStr) return 10 * 1024 * 1024; // 기본 10MB
  const m = String(sizeStr).trim().match(/^(\d+(?:\.\d+)?)\s*([KMGT]?)B?$/i);
  if (!m) return parseInt(sizeStr) || 10 * 1024 * 1024;
  const n = parseFloat(m[1]);
  switch (m[2].toUpperCase()) {
    case 'K': return Math.floor(n * 1024);
    case 'M': return Math.floor(n * 1024 * 1024);
    case 'G': return Math.floor(n * 1024 * 1024 * 1024);
    case 'T': return Math.floor(n * 1024 * 1024 * 1024 * 1024);
    default:  return Math.floor(n);
  }
}

/**
 * 디렉토리 내 로그 파일 목록 (base 기준 .1 .2 ... 포함)
 * 수정 시간 오름차순 정렬 (가장 오래된 것 앞)
 */
function listLogFiles(dir: string, base: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const all = fs.readdirSync(dir);
  const pattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\.\\d+)?(\\.gz)?$`);
  return all
    .filter(f => pattern.test(f))
    .map(f => path.join(dir, f))
    .sort((a, b) => {
      try {
        return fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs;
      } catch {
        return 0;
      }
    });
}

/**
 * 단순 cron 매칭 (분 시 일 월 요일)
 * "0 0 * * *" → 자정에 true
 */
function cronMatches(expr: string, now: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return false;
  const [min, hour, dom, mon, dow] = parts;
  const check = (field: string, val: number): boolean => {
    if (field === '*') return true;
    if (field.includes('/')) {
      const [, step] = field.split('/');
      return val % parseInt(step) === 0;
    }
    if (field.includes('-')) {
      const [start, end] = field.split('-').map(Number);
      return val >= start && val <= end;
    }
    if (field.includes(',')) {
      return field.split(',').map(Number).includes(val);
    }
    return parseInt(field) === val;
  };
  return (
    check(min,  now.getMinutes()) &&
    check(hour, now.getHours()) &&
    check(dom,  now.getDate()) &&
    check(mon,  now.getMonth() + 1) &&
    check(dow,  now.getDay())
  );
}

// ─────────────────────────────────────────────────────────────
// 네이티브 함수 등록
// ─────────────────────────────────────────────────────────────

export function registerLogrotateFunctions(registry: NativeFunctionRegistry): void {

  // ── logrotate_file_size: 파일 크기 (바이트) ──────────────
  registry.register({
    name: 'logrotate_file_size',
    module: 'logrotate',
    executor: (args) => {
      const filePath = String(args[0] ?? '');
      try {
        return fs.existsSync(filePath) ? fs.statSync(filePath).size : -1;
      } catch {
        return -1;
      }
    }
  });

  // ── logrotate_parse_size: "10M" → bytes ──────────────────
  registry.register({
    name: 'logrotate_parse_size',
    module: 'logrotate',
    executor: (args) => parseSizeToBytes(String(args[0] ?? '10M'))
  });

  // ── logrotate_now_unix: 현재 Unix timestamp (ms) ─────────
  registry.register({
    name: 'logrotate_now_unix',
    module: 'logrotate',
    executor: () => Date.now()
  });

  // ── logrotate_rotate_file: 로테이션 실행 ─────────────────
  // logPath.1 → logPath.2, logPath → logPath.1
  registry.register({
    name: 'logrotate_rotate_file',
    module: 'logrotate',
    executor: (args) => {
      const logPath = String(args[0] ?? '');
      const maxN    = Number(args[1] ?? 30);
      try {
        if (!fs.existsSync(logPath)) {
          return `skip:not_found:${logPath}`;
        }
        const dir  = path.dirname(logPath);
        const base = path.basename(logPath);

        // 가장 큰 번호부터 한 칸씩 밀기
        for (let i = maxN - 1; i >= 1; i--) {
          const src  = path.join(dir, `${base}.${i}`);
          const srcGz = src + '.gz';
          const dst  = path.join(dir, `${base}.${i + 1}`);
          const dstGz = dst + '.gz';
          if (fs.existsSync(src))   { try { fs.renameSync(src,   dst);   } catch {} }
          if (fs.existsSync(srcGz)) { try { fs.renameSync(srcGz, dstGz); } catch {} }
        }

        // 현재 로그 → .1
        const rotatedPath = path.join(dir, `${base}.1`);
        fs.renameSync(logPath, rotatedPath);

        // 빈 로그 파일 재생성
        fs.writeFileSync(logPath, '', { flag: 'w' });

        return `ok:${rotatedPath}`;
      } catch (e: any) {
        return `error:${e.message}`;
      }
    }
  });

  // ── logrotate_compress_file: gzip 압축 ───────────────────
  registry.register({
    name: 'logrotate_compress_file',
    module: 'logrotate',
    executor: (args) => {
      const filePath = String(args[0] ?? '');
      const gzPath   = filePath + '.gz';
      try {
        if (!fs.existsSync(filePath)) return `error:not_found:${filePath}`;
        const input  = fs.createReadStream(filePath);
        const output = fs.createWriteStream(gzPath);
        const gzip   = zlib.createGzip({ level: 6 });
        // 동기 방식으로 처리 (스트림 기반 비동기를 동기화)
        const buf = fs.readFileSync(filePath);
        const compressed = zlib.gzipSync(buf, { level: 6 });
        fs.writeFileSync(gzPath, compressed);
        fs.unlinkSync(filePath);
        return `ok:${gzPath}`;
      } catch (e: any) {
        return `error:${e.message}`;
      }
    }
  });

  // ── logrotate_cleanup_dir: 오래된 파일 삭제 ──────────────
  registry.register({
    name: 'logrotate_cleanup_dir',
    module: 'logrotate',
    executor: (args) => {
      const dir      = String(args[0] ?? '');
      const base     = String(args[1] ?? 'app.log');
      const maxFiles = Number(args[2] ?? 30);
      try {
        const files = listLogFiles(dir, base);
        // 현재 로그(번호 없는 것) 제외한 로테이션 파일만
        const rotated = files.filter(f => f !== path.join(dir, base));
        if (rotated.length <= maxFiles) return 0;
        const toDelete = rotated.slice(0, rotated.length - maxFiles);
        let count = 0;
        for (const f of toDelete) {
          try { fs.unlinkSync(f); count++; } catch {}
        }
        return count;
      } catch {
        return 0;
      }
    }
  });

  // ── logrotate_list_log_files: 로그 파일 목록 (JSON) ──────
  registry.register({
    name: 'logrotate_list_log_files',
    module: 'logrotate',
    executor: (args) => {
      const dir  = String(args[0] ?? '');
      const base = String(args[1] ?? 'app.log');
      try {
        const files = listLogFiles(dir, base);
        return JSON.stringify(files.map(f => {
          try {
            const stat = fs.statSync(f);
            return { path: f, size: stat.size, mtime: stat.mtimeMs };
          } catch {
            return { path: f, size: -1, mtime: 0 };
          }
        }));
      } catch {
        return '[]';
      }
    }
  });

  // ── logrotate_cron_matches: cron 표현식 현재 시각 매칭 ───
  registry.register({
    name: 'logrotate_cron_matches',
    module: 'logrotate',
    executor: (args) => {
      const expr = String(args[0] ?? '0 0 * * *');
      return cronMatches(expr, new Date());
    }
  });

  // ── logrotate_file_exists: 파일 존재 여부 ────────────────
  registry.register({
    name: 'logrotate_file_exists',
    module: 'logrotate',
    executor: (args) => {
      try { return fs.existsSync(String(args[0] ?? '')); }
      catch { return false; }
    }
  });
}
