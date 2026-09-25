#!/usr/bin/env python3
"""Keep the authored GitHub feedback wait inside the opt-in review policy."""

import json
import os


print(
    json.dumps(
        {
            "answer": (
                "no"
                if os.environ.get("CODEINFO_GITHUB_REVIEW_SKIPPED") == "1"
                else "yes"
            )
        }
    )
)
