FROM python:3.12-slim

WORKDIR /workspace/labeling-ui

COPY labeling-ui/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

ENV PYTHONPATH=/workspace/src
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
