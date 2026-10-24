# Keep the existing PostgreSQL 17 Alpine runtime, including its libc/collations.
# Upgrade this digest only after checking the existing PG major and runtime compatibility.
ARG POSTGRES_BASE=postgres:17-alpine@sha256:eee6c6e1b0894fa4fe0075eb054af9fd1cf39a35321c2d4110626cfe506411fb
FROM ${POSTGRES_BASE} AS vector_build
RUN apk add --no-cache build-base git
ADD https://github.com/pgvector/pgvector.git#v0.8.7 /tmp/pgvector
RUN make -C /tmp/pgvector OPTFLAGS="" with_llvm=no && make -C /tmp/pgvector install with_llvm=no

FROM ${POSTGRES_BASE}
COPY --from=vector_build /usr/local/lib/postgresql/vector.so /usr/local/lib/postgresql/vector.so
COPY --from=vector_build /usr/local/share/postgresql/extension/vector* /usr/local/share/postgresql/extension/
