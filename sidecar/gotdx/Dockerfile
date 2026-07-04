FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY main.go .
RUN CGO_ENABLED=0 go build -o gotdx-server .

FROM alpine:3.19
COPY --from=builder /app/gotdx-server /usr/local/bin/
EXPOSE 19801
ENTRYPOINT ["gotdx-server"]
