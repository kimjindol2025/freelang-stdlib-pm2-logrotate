# freelang-stdlib-pm2-logrotate

FreeLang v2 stdlib — npm **pm2-logrotate** 완전 대체

## 기능

| 함수 | 설명 |
|------|------|
| `configure(config)` | 로테이션 설정 적용 |
| `rotate()` | 즉시 수동 로테이션 → RotateResult |
| `compress(filePath)` | 단일 파일 gzip 압축 |
| `cleanup(dir, maxFiles)` | 오래된 파일 삭제 |
| `checkAndRotate()` | 크기/cron 조건 기반 자동 로테이션 |
| `getFileList()` | 현재 로그 파일 목록 |
| `getStatus()` | 설정 및 파일 상태 조회 |

## 사용법

```fl
import "stdlib/pm2-logrotate"

configure({
  logPath:        "/var/log/app/app.log",
  maxSize:        "10M",
  maxFiles:       30,
  compress:       true,
  workerInterval: 30,
  rotateInterval: "0 0 * * *"
})

let result = rotate()
println(result.rotated)      // /var/log/app/app.log.1
println(result.compressed)   // /var/log/app/app.log.1.gz
println(result.deleted)      // 0 (삭제된 파일 수)
println(result.reason)       // "manual"
```

## 네이티브 함수 (stdlib-logrotate.ts)

| 함수 | 설명 |
|------|------|
| `logrotate_file_size(path)` | 파일 크기 (바이트) |
| `logrotate_parse_size(str)` | "10M" → 바이트 변환 |
| `logrotate_rotate_file(path, maxN)` | 파일 로테이션 실행 |
| `logrotate_compress_file(path)` | gzip 압축 |
| `logrotate_cleanup_dir(dir, base, max)` | 오래된 파일 삭제 |
| `logrotate_list_log_files(dir, base)` | 파일 목록 (JSON) |
| `logrotate_cron_matches(expr)` | cron 현재 시각 매칭 |
| `logrotate_file_exists(path)` | 파일 존재 여부 |
| `logrotate_now_unix()` | Unix timestamp (ms) |
