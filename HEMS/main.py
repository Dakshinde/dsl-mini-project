from fastapi import FastAPI

app = FastAPI(title="HEMS Phase 4 Backend")


@app.get("/health", summary="Health check endpoint")
def health_check():
    """
    Root health check endpoint.
    
    Returns basic status information about the HEMS backend service.
    This is the first endpoint to verify the FastAPI server is running correctly.
    """
    return {
        "status": "healthy",
        "service": "HEMS Phase 4 Backend",
        "version": "0.1.0",
        "message": "HEMS backend is running successfully."
    }