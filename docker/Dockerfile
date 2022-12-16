############################################################
# Frontend Build
############################################################
FROM node:18.12.1-alpine as frontendBuilder

ARG GIT_SHA
ARG GIT_REF
ARG BUILD_TIMESTAMP
ARG BUILT_FROM_PUSH
ARG SHOW_BULK_DELETE_BUTTONS

WORKDIR /app
ENV PATH /app/node_modules/.bin:$PATH

COPY ./frontend/package.json ./package.json
COPY ./frontend/package-lock.json ./package-lock.json
COPY ./frontend/scripts ./scripts
RUN npm ci


# From: https://docs.docker.com/engine/reference/builder/#using-arg-variables
# We want to bake the envVars into the image (and react app), or abort if they're not set
# ENV values are persistet in the built image, ARG instructions are not!

# git sha of the commit
RUN test -n "$GIT_SHA" || (echo "GIT_SHA must be set" && false)
ENV REACT_APP_CONSOLE_GIT_SHA ${GIT_SHA}

# name of the git branch
RUN test -n "$GIT_REF" || (echo "GIT_REF must be set" && false)
ENV REACT_APP_CONSOLE_GIT_REF ${GIT_REF}

# timestamp in unix seconds when the image was built
RUN test -n "$BUILD_TIMESTAMP" || (echo "BUILD_TIMESTAMP must be set" && false)
ENV REACT_APP_BUILD_TIMESTAMP ${BUILD_TIMESTAMP}

# whether the image was build in response to a push (as opposed to an intentional "release")
ENV REACT_APP_BUILT_FROM_PUSH ${BUILT_FROM_PUSH}

# show bulk delete buttons on user preferences
ENV REACT_APP_SHOW_BULK_DELETE_BUTTONS ${SHOW_BULK_DELETE_BUTTONS}

COPY ./frontend/public ./public
COPY ./frontend/src ./src
COPY ./frontend/.eslintrc.json ./.eslintrc.json
COPY ./frontend/.npmrc ./.npmrc
COPY ./frontend/.nvmrc ./.nvmrc
COPY ./frontend/module-federation.js ./module-federation.js
COPY ./frontend/tsconfig.json ./tsconfig.json
RUN npm run build
# All the built frontend files for the SPA are now in '/app/build/'

############################################################
# Backend Build
############################################################
FROM golang:1.19.4-alpine as builder

ARG GIT_REF
ARG BUILD_TIMESTAMP

RUN apk update && apk add --no-cache git ca-certificates && update-ca-certificates

WORKDIR /app

COPY ./backend/go.mod .
COPY ./backend/go.sum .
RUN go mod download

COPY ./backend .
# Copy frontend build into embed directory so that we can embed
# the SPA into the Go binary via go embed.
COPY --from=frontendBuilder /app/build/ ./pkg/embed/frontend

RUN CGO_ENABLED=0 go build \
-ldflags="-w -s \
    -X github.com/redpanda-data/console/backend/pkg/version.Version=$GIT_REF \
    -X github.com/redpanda-data/console/backend/pkg/version.BuiltAt=$BUILD_TIMESTAMP" \
    -o ./bin/console ./cmd/api
# Compiled backend binary is in '/app/bin/' named 'console'


############################################################
# Final Image
############################################################
FROM alpine:3.17.0

WORKDIR /app

# COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /app/bin/console /app/console

RUN apk update \
    # && apk add --no-cache openssh \
    && apk add --no-cache tzdata \
    && apk add --no-cache bash

# Add github.com to known SSH hosts by default (required for pulling topic docs & proto files from a Git repo)
# RUN ssh-keyscan github.com >> /etc/ssh/ssh_known_hosts

ENV TZ=America/Sao_Paulo

USER 1001

ENTRYPOINT ["./console", "--config.filepath=/etc/rpconsole/config.yaml"]
