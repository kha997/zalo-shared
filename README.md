# Zalo Shared

Inbox tập trung cho một tài khoản Zalo cá nhân và nhiều nhân viên, với tài khoản và phân quyền riêng, phân công hội thoại, lịch sử thao tác và hàng đợi gửi bền vững.

> **Trạng thái: đang phát triển và kiểm chứng trên provider giả lập. Chưa PRODUCTION-READY.** Chưa kết nối Zalo thật, chưa chứng minh điện thoại chính hoạt động đồng thời. Không triển khai production hoặc sử dụng dữ liệu khách hàng.

## Đã triển khai

- UI tiếng Việt: đăng nhập, inbox, tìm kiếm/lọc, phân công, soạn tin và đính kèm, trạng thái gửi, quản trị nhân viên và audit.
- Fastify/TypeScript, React, PostgreSQL. Session cookie HttpOnly, token băm, CSRF/Origin, quyền hiện hành, không đăng ký công khai.
- Ghi message + outbox + audit trong transaction; khóa phiên bản phân công; Idempotency-Key; dedup inbound; trạng thái unknown không tự gửi lại.
- File riêng tư trong PostgreSQL, kiểm tra loại/kích thước; không fetch URL tùy ý.
- Provider mock có ledger bền vững; worker một chủ sở hữu; không có giới hạn cứng bốn nhân viên.
- Bộ kiểm thử PostgreSQL, Chromium nhiều phiên, load nhiều mức; Compose nội bộ, CI, backup mã hóa và restore cách ly.

## Đọc trước

- [Trạng thái kiểm chứng và các cổng còn mở](docs/READINESS.md)
- [Thiết kế và quyết định kiến trúc](docs/DESIGN.md)
- [API và quyền truy cập](docs/API.md)
- [Roadmap và ledger triển khai](docs/plans/implementation.md)
- [Nghiên cứu ban đầu](docs/research/REPORT.md)
- [Review kiến trúc độc lập](docs/review/architecture-review.md)
- [Review bảo mật code vòng đầu](docs/review/security-code-review.md)
- [Tài liệu vận hành](docs/operations/RUNBOOK.md)

## Chạy local

Yêu cầu Node.js >=24, PostgreSQL 17. Không dùng database hay tài khoản thật.

```sh
npm ci
# Đặt DATABASE_URL, MIGRATION_DATABASE_URL, PUBLIC_ORIGIN và ADMIN_EMAIL/ADMIN_PASSWORD
# trong môi trường riêng; không commit hoặc in giá trị lên log.
npm run migrate
npm run seed
npm run build
npm start
```

Server mặc định chỉ bind `127.0.0.1:3100`. Mặc định provider bị vô hiệu hóa. Chỉ trong môi trường synthetic, bật `PROVIDER_MODE=mock` và `MOCK_ENABLED=true` rồi chạy `npm run worker`. `NODE_ENV=production` từ chối mock; không có live login/QR được bật trong release này.

```sh
# TEST_DATABASE_URL phải là DB thử nghiệm riêng, có thể bị reset.
npm test
npm run test:e2e
npm run test:load
```

Browser/load yêu cầu app và mock worker đang chạy, `TEST_ADMIN_EMAIL`/`TEST_ADMIN_PASSWORD` cung cấp qua môi trường. Không có credential mặc định. Chromium local: `CHROMIUM_PATH=/usr/bin/chromium`; CI: `CHROMIUM_PATH=bundled` sau `npx playwright install chromium`.

## Giới hạn bắt buộc

Không suy ra khả năng Zalo thật từ simulator, số browser profile từ số workstation vật lý, hay khả năng mở rộng không giới hạn từ một load run. Kết quả gửi không xác định cần đối soát; không thể hứa exactly-once với provider không hỗ trợ idempotency. PostgreSQL lock không ngăn được process cũ bị treo tiếp tục gửi ra provider sau failover; live failover cần fencing vận hành. Điều khoản và nguy cơ khóa tài khoản Zalo vẫn tồn tại.

Các snapshot source upstream không rõ giấy phép không được đưa vào repo này. Báo cáo nghiên cứu giữ URL/revision nguồn; file/harness lịch sử tại môi trường nghiên cứu không phải ứng dụng build được trong repo này. Code sản phẩm mới được viết độc lập. Chưa chọn giấy phép phân phối cho sản phẩm.
