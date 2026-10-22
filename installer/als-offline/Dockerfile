FROM python:3.11-slim-bookworm@sha256:0a310eeecf4e1f5a0743f9a6520c90c88d089c903ca5fd283f501e3a805f5f89
WORKDIR /opt/fixture
COPY requirements.lock /opt/fixture/requirements.lock
RUN python -m pip install --no-cache-dir -r requirements.lock
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTEST_DISABLE_PLUGIN_AUTOLOAD=1
USER 65534:65534
CMD ["python", "-m", "unittest", "discover", "-s", "/grader", "-p", "test_environment.py", "-v"]
