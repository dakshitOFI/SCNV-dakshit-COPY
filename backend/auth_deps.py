import os
import jwt
from jwt import PyJWKClient
from fastapi import HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from typing import Optional
security = HTTPBearer(auto_error=False)

def get_supabase_jwks_url():
    # Attempt env var, fallback to the known project URL
    url = os.getenv("SUPABASE_URL", "https://nvdoiirgulzoncuecwdy.supabase.co")
    return f"{url}/auth/v1/.well-known/jwks.json"

def verify_supabase_jwt(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(security)
):
    """
    Dependency that verifies the Supabase JWT from the Authorization Bearer header.
    Raises HTTP 401 if the token is missing, expired, or has an invalid signature.
    """

    # Validate presence of credentials and token
    if (
        not credentials
        or not credentials.credentials
        or credentials.credentials in ["null", "undefined", ""]
    ):
        raise HTTPException(
            status_code=401,
            detail="Authorization token required"
        )

    token = credentials.credentials

    try:
        # Fetch JWKS (JSON Web Key Set) from Supabase
        jwks_client = PyJWKClient(get_supabase_jwks_url())

        # Retrieve the signing key from the JWT
        signing_key = jwks_client.get_signing_key_from_jwt(token)

        # Decode and verify the JWT
        data = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            options={"verify_aud": False}
        )

        return data

    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=401,
            detail="Token has expired"
        )

    except Exception:
        raise HTTPException(
            status_code=401,
            detail="Invalid authorization token"
        )
