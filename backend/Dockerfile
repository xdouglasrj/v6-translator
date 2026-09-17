FROM python:3.12-slim

WORKDIR /app

# Only the packages the realtime client-secret route needs; the full
# requirements.txt carries Emergent leftovers that do not build here.
COPY requirements-realtime.txt ./
RUN pip install --no-cache-dir -r requirements-realtime.txt

COPY server.py ./

EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
