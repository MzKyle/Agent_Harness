"""Detection fixture only. No real data, worker, CVAT, or device connections."""
def health():
    return {"status": "fixture"}
