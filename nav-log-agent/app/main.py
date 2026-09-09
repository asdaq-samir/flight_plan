from .mcp_server import mcp

if __name__ == "__main__":
    # host="0.0.0.0" is required, not cosmetic -- the library's own default
    # (127.0.0.1) is only reachable from inside the container's own network
    # namespace, which breaks both the local Docker port mapping (8082:8000)
    # and reachability from the ALB once this runs on ECS Fargate. sse_path/
    # message_path are set explicitly so they're a known, stable contract
    # (/mcp/sse, /mcp/messages/) that infra/cloudformation/template.yaml's
    # ALB path-based route (/mcp/*) can target, rather than depending on the
    # library's own unprefixed defaults (/sse, /messages/).
    mcp.run(
        transport="sse",
        host="0.0.0.0",
        port=8000,
        sse_path="/mcp/sse",
        message_path="/mcp/messages/",
    )
