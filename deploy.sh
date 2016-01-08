#!/bin/sh

COMMIT_MSG=$1
rm -r ../vvvvalvalval.github.io/*
cp -R ./resources/public/* ../vvvvalvalval.github.io/
cd ../vvvvalvalval.github.io/
git add .
git ci -m "$COMMIT_MSG"
git push origin master