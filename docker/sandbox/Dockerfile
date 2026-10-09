FROM debian:bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    python3 \
    python3-pip \
    ripgrep \
  && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 1000 --shell /bin/bash nova \
  && mkdir -p /var/nova/workspaces \
  && chown -R nova:nova /var/nova

USER nova
WORKDIR /var/nova/workspaces
CMD ["sleep", "infinity"]
