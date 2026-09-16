FROM python:3.13-slim

WORKDIR /workspace/nav-log-agent

COPY nav-log-agent/requirements.txt .
# sentence-transformers pulls torch, and the default torch wheel brings
# several GB of CUDA/cuDNN with it -- 3.2 GB of nvidia/ plus a 1.2 GB
# torch in an image that runs on a laptop and deploys to Fargate, neither
# of which has a GPU. Installing the CPU wheel first means the dependency
# is already satisfied when sentence-transformers asks for it.
# docker/Dockerfile.ml does the same thing for the same reason.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r requirements.txt

ENV PYTHONPATH=/workspace/src
ENTRYPOINT ["python3", "-m", "app.main"]
