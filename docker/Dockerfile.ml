FROM python:3.14-slim

WORKDIR /workspace

# PySpark needs a JVM.
RUN apt-get update && apt-get install -y --no-install-recommends default-jdk-headless \
    && rm -rf /var/lib/apt/lists/*
ENV JAVA_HOME=/usr/lib/jvm/default-java

COPY docker/requirements-ml.txt .
# CPU-only wheel -- this container has no GPU to use, and the default
# torch wheel pulls several GB of unused CUDA/cuDNN dependencies.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -r requirements-ml.txt

EXPOSE 8888

CMD ["jupyter", "notebook", "--no-browser", "--ip=0.0.0.0", "--allow-root", \
     "--NotebookApp.notebook_dir=/workspace", "--NotebookApp.token=vfr"]
